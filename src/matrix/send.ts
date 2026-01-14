/**
 * Send messages to Matrix rooms.
 * Handles text chunking, markdown conversion, replies, and media attachments.
 */

import type { MatrixClient } from "matrix-js-sdk";
import { EventType, MsgType } from "matrix-js-sdk";
import {
  makeHtmlMessage,
  makeTextMessage,
} from "matrix-js-sdk/lib/content-helpers.js";
import type { RoomMessageEventContent } from "matrix-js-sdk/lib/@types/events.js";

import { chunkMarkdownText } from "../auto-reply/chunk.js";
import { loadConfig } from "../config/config.js";
import { recordChannelActivity } from "../infra/channel-activity.js";
import { logVerbose } from "../globals.js";
import { loadWebMedia } from "../web/media.js";
import { resolveMatrixAccount } from "./accounts.js";
import {
  createMatrixClient,
  loginMatrix,
  stopMatrixClient,
} from "./client.js";
import { markdownToMatrixHtml } from "./format.js";

const MATRIX_TEXT_LIMIT = 4000;

export type MatrixSendOpts = {
  /** Account ID for multi-account setups. */
  accountId?: string;
  /** Existing Matrix client to reuse (skips login). */
  client?: MatrixClient;
  /** Event ID to reply to (creates threaded reply). */
  replyTo?: string;
  /** Room ID where the original message was sent (for reply context). */
  replyToRoomId?: string;
  /** Sender of the original message (for reply formatting). */
  replyToSender?: string;
  /** Body of the original message (for reply formatting). */
  replyToBody?: string;
  /** URL of media file to attach. */
  mediaUrl?: string;
  /** Override text chunk limit. */
  textChunkLimit?: number;
  /** Whether to convert markdown to HTML (default: true). */
  formatted?: boolean;
};

export type MatrixSendResult = {
  eventId: string;
  roomId: string;
};

export class MatrixSendError extends Error {
  kind?: "auth-failed" | "room-not-found" | "permission-denied";
  roomId?: string;

  constructor(message: string, opts?: Partial<MatrixSendError>) {
    super(message);
    this.name = "MatrixSendError";
    if (opts) Object.assign(this, opts);
  }

  override toString() {
    return this.message;
  }
}

type MatrixRecipient = {
  kind: "room";
  id: string;
};

function parseRecipient(raw: string): MatrixRecipient {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new MatrixSendError("Recipient room ID is required for Matrix sends");
  }

  // Matrix room IDs start with ! and room aliases start with #
  if (trimmed.startsWith("!") || trimmed.startsWith("#")) {
    return { kind: "room", id: trimmed };
  }

  // Allow "room:" prefix for explicit room IDs
  if (trimmed.startsWith("room:")) {
    return { kind: "room", id: trimmed.slice("room:".length) };
  }

  // Assume raw ID is a room ID
  return { kind: "room", id: trimmed };
}

async function resolveRoomId(
  client: MatrixClient,
  recipient: MatrixRecipient,
): Promise<string> {
  const { id } = recipient;

  // If it's a room alias (starts with #), resolve to room ID
  if (id.startsWith("#")) {
    try {
      const result = await client.getRoomIdForAlias(id);
      return result.room_id;
    } catch (err) {
      throw new MatrixSendError(
        `Failed to resolve Matrix room alias "${id}": ${String(err)}`,
        { kind: "room-not-found", roomId: id },
      );
    }
  }

  // Already a room ID (starts with !)
  return id;
}

async function getOrCreateClient(opts: {
  accountId?: string;
  client?: MatrixClient;
}): Promise<{ client: MatrixClient; shouldStop: boolean }> {
  if (opts.client) {
    return { client: opts.client, shouldStop: false };
  }

  const cfg = loadConfig();
  const account = resolveMatrixAccount({ cfg, accountId: opts.accountId });

  if (!account.homeserver) {
    throw new MatrixSendError(
      `Matrix homeserver not configured for account "${account.accountId}"`,
      { kind: "auth-failed" },
    );
  }

  if (!account.accessToken && !account.password) {
    throw new MatrixSendError(
      `Matrix credentials not configured for account "${account.accountId}" (need accessToken or password)`,
      { kind: "auth-failed" },
    );
  }

  const client = createMatrixClient({
    homeserver: account.homeserver,
    userId: account.userId,
    accessToken: account.accessToken,
    deviceId: account.deviceId,
    storeType: "memory",
  });

  try {
    await loginMatrix(client, {
      userId: account.userId,
      accessToken: account.accessToken,
      password: account.password,
      deviceId: account.deviceId,
    });

    // For send-only operations, we can skip sync
    // The client is ready after login
  } catch (err) {
    throw new MatrixSendError(
      `Matrix authentication failed: ${String(err)}`,
      { kind: "auth-failed" },
    );
  }

  return { client, shouldStop: true };
}

function buildMessageContent(
  body: string,
  opts: {
    formatted?: boolean;
    replyTo?: string;
    replyToSender?: string;
    replyToBody?: string;
  },
): ReturnType<typeof makeTextMessage> {
  const { formatted = true, replyTo, replyToSender, replyToBody } = opts;

  // Build base content using SDK helpers
  let content: ReturnType<typeof makeTextMessage>;
  if (formatted) {
    const html = markdownToMatrixHtml(body);
    content = makeHtmlMessage(body, html);
  } else {
    content = makeTextMessage(body);
  }

  // Add reply relation
  if (replyTo) {
    // Add reply relation - extend the content object
    const contentWithReply = content as unknown as Record<string, unknown>;
    contentWithReply["m.relates_to"] = {
      "m.in_reply_to": {
        event_id: replyTo,
      },
    };

    // Matrix clients expect a fallback quote in the body for replies
    if (replyToSender && replyToBody) {
      const quotedBody = replyToBody
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
      content.body = `> <${replyToSender}> ${quotedBody.replace(/^> /, "")}\n\n${body}`;

      if (formatted && "formatted_body" in content) {
        const escapedOriginal = escapeHtml(replyToBody);
        const escapedNew = markdownToMatrixHtml(body);
        (content as { formatted_body?: string }).formatted_body =
          `<mx-reply><blockquote>` +
          `<a href="https://matrix.to/#/${escapeHtml(replyToSender)}">` +
          `${escapeHtml(replyToSender)}</a><br>` +
          `${escapedOriginal}</blockquote></mx-reply>` +
          escapedNew;
      }
    }
  }

  return content;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function sendMatrixText(
  client: MatrixClient,
  roomId: string,
  text: string,
  opts: {
    formatted?: boolean;
    replyTo?: string;
    replyToSender?: string;
    replyToBody?: string;
    textChunkLimit?: number;
  },
): Promise<{ eventId: string }> {
  if (!text.trim()) {
    throw new MatrixSendError("Message must be non-empty for Matrix sends");
  }

  const limit = opts.textChunkLimit ?? MATRIX_TEXT_LIMIT;
  const chunks = chunkMarkdownText(text, limit);

  if (chunks.length === 0) {
    throw new MatrixSendError("Message resulted in empty chunks");
  }

  let lastEventId: string | undefined;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const isFirst = i === 0;

    const content = buildMessageContent(chunk, {
      formatted: opts.formatted,
      // Only add reply context to the first chunk
      replyTo: isFirst ? opts.replyTo : undefined,
      replyToSender: isFirst ? opts.replyToSender : undefined,
      replyToBody: isFirst ? opts.replyToBody : undefined,
    });

    try {
      const result = await client.sendMessage(roomId, content);
      lastEventId = result.event_id;
    } catch (err) {
      const errStr = String(err);
      if (errStr.includes("M_FORBIDDEN")) {
        throw new MatrixSendError(
          `Permission denied to send message to room ${roomId}`,
          { kind: "permission-denied", roomId },
        );
      }
      if (errStr.includes("M_NOT_FOUND") || errStr.includes("M_UNKNOWN")) {
        throw new MatrixSendError(
          `Room ${roomId} not found or not accessible`,
          { kind: "room-not-found", roomId },
        );
      }
      throw new MatrixSendError(`Failed to send Matrix message: ${errStr}`, {
        roomId,
      });
    }
  }

  return { eventId: lastEventId! };
}

async function sendMatrixMedia(
  client: MatrixClient,
  roomId: string,
  text: string,
  mediaUrl: string,
  opts: {
    formatted?: boolean;
    replyTo?: string;
    replyToSender?: string;
    replyToBody?: string;
    textChunkLimit?: number;
  },
): Promise<{ eventId: string }> {
  // Load media from URL
  const media = await loadWebMedia(mediaUrl);
  const contentType = media.contentType ?? "application/octet-stream";
  const fileName = media.fileName ?? "upload";

  // Upload media to Matrix server
  // Convert Node.js Buffer to Uint8Array for matrix-js-sdk compatibility
  let mxcUrl: string;
  try {
    const uint8Array = new Uint8Array(media.buffer);
    const blob = new Blob([uint8Array], { type: contentType });
    const uploadResult = await client.uploadContent(blob, {
      name: fileName,
      type: contentType,
    });
    mxcUrl = uploadResult.content_uri;
  } catch (err) {
    throw new MatrixSendError(
      `Failed to upload media to Matrix: ${String(err)}`,
      { roomId },
    );
  }

  // Determine message type based on content type
  let msgtype = MsgType.File;
  if (contentType.startsWith("image/")) {
    msgtype = MsgType.Image;
  } else if (contentType.startsWith("audio/")) {
    msgtype = MsgType.Audio;
  } else if (contentType.startsWith("video/")) {
    msgtype = MsgType.Video;
  }

  // Build media message content
  // Media content structure follows Matrix spec for m.file/m.image/m.audio/m.video
  const content: Record<string, unknown> = {
    msgtype,
    body: fileName,
    url: mxcUrl,
    info: {
      mimetype: contentType,
      size: media.buffer.length,
    },
  };

  // Add reply relation if specified
  if (opts.replyTo) {
    content["m.relates_to"] = {
      "m.in_reply_to": {
        event_id: opts.replyTo,
      },
    };
  }

  // Send media message using sendEvent for more flexible content type
  let mediaEventId: string;
  try {
    const result = await client.sendEvent(
      roomId,
      EventType.RoomMessage,
      content as unknown as RoomMessageEventContent,
    );
    mediaEventId = result.event_id;
  } catch (err) {
    throw new MatrixSendError(
      `Failed to send Matrix media message: ${String(err)}`,
      { roomId },
    );
  }

  // If there's also text, send it as a follow-up message
  if (text.trim()) {
    const textResult = await sendMatrixText(client, roomId, text, {
      formatted: opts.formatted,
      textChunkLimit: opts.textChunkLimit,
      // Don't add reply context to text - media message already has it
    });
    return textResult;
  }

  return { eventId: mediaEventId };
}

/**
 * Send a message to a Matrix room.
 *
 * @param to - Room ID (starting with !) or room alias (starting with #)
 * @param text - Message text (supports markdown)
 * @param opts - Optional configuration
 * @returns Event ID and room ID of the sent message
 */
export async function sendMessageMatrix(
  to: string,
  text: string,
  opts: MatrixSendOpts = {},
): Promise<MatrixSendResult> {
  const cfg = loadConfig();
  const accountInfo = resolveMatrixAccount({
    cfg,
    accountId: opts.accountId,
  });

  const recipient = parseRecipient(to);
  const { client, shouldStop } = await getOrCreateClient({
    accountId: opts.accountId,
    client: opts.client,
  });

  try {
    const roomId = await resolveRoomId(client, recipient);

    let result: { eventId: string };

    if (opts.mediaUrl) {
      result = await sendMatrixMedia(client, roomId, text, opts.mediaUrl, {
        formatted: opts.formatted,
        replyTo: opts.replyTo,
        replyToSender: opts.replyToSender,
        replyToBody: opts.replyToBody,
        textChunkLimit: opts.textChunkLimit ?? accountInfo.config.textChunkLimit,
      });
    } else {
      result = await sendMatrixText(client, roomId, text, {
        formatted: opts.formatted,
        replyTo: opts.replyTo,
        replyToSender: opts.replyToSender,
        replyToBody: opts.replyToBody,
        textChunkLimit: opts.textChunkLimit ?? accountInfo.config.textChunkLimit,
      });
    }

    recordChannelActivity({
      channel: "matrix",
      accountId: accountInfo.accountId,
      direction: "outbound",
    });

    logVerbose(`matrix: sent message to ${roomId}: ${result.eventId}`);

    return {
      eventId: result.eventId,
      roomId,
    };
  } finally {
    if (shouldStop) {
      await stopMatrixClient(client);
    }
  }
}
