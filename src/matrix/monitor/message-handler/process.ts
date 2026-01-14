/**
 * Matrix message processing.
 *
 * Processes messages that passed preflight checks:
 * - Extracts message content (body, formatted_body)
 * - Parses reply context if present
 * - Builds message context for dispatch
 * - Routes to session via dispatchReplyWithBufferedBlockDispatcher
 *
 * Follows Discord/Slack patterns for non-blocking dispatch.
 */

import { resolveEffectiveMessagesConfig } from "../../../agents/identity.js";
import { resolveTextChunkLimit } from "../../../auto-reply/chunk.js";
import { formatAgentEnvelope } from "../../../auto-reply/envelope.js";
import {
  buildHistoryContextFromMap,
  clearHistoryEntries,
} from "../../../auto-reply/reply/history.js";
import { dispatchReplyWithBufferedBlockDispatcher } from "../../../auto-reply/reply/provider-dispatcher.js";
import type { ReplyPayload } from "../../../auto-reply/types.js";
import { danger, logVerbose, shouldLogVerbose } from "../../../globals.js";
import { recordChannelActivity } from "../../../infra/channel-activity.js";
import { sendMessageMatrix } from "../../send.js";
import { sendMatrixTyping, stopMatrixTyping } from "../../typing.js";
import type { MatrixPreflightContext } from "./preflight.js";

/**
 * Process a Matrix message that passed preflight checks.
 *
 * Non-blocking: dispatches to agent and delivers replies inline.
 * Handles typing indicators, history context, and reply threading.
 */
export async function processMatrixMessage(
  prepared: MatrixPreflightContext,
): Promise<boolean> {
  const { ctx, message, meta, isDirect, roomName, senderDisplayName, route } =
    prepared;
  const { roomId, sender, body, eventId, timestamp, replyTo, formattedBody } =
    message;

  // Build sender label for envelope
  const senderLabel = buildSenderLabel({
    sender,
    displayName: senderDisplayName,
  });

  // Build room label for envelope
  const roomLabel = buildRoomLabel({
    roomId,
    roomName,
    isDirect,
  });

  // Build the message envelope
  const rawBody = body;
  const envelopeBody = formatAgentEnvelope({
    channel: "Matrix",
    from: isDirect ? senderLabel : `${roomLabel} from ${senderLabel}`,
    timestamp,
    body: rawBody,
  });

  // Build combined body with history context for room messages
  let combinedBody = envelopeBody;
  const historyKey = !isDirect ? roomId : undefined;

  if (historyKey && ctx.historyLimit > 0 && prepared.historyEntry) {
    combinedBody = buildHistoryContextFromMap({
      historyMap: ctx.roomHistories,
      historyKey,
      limit: ctx.historyLimit,
      entry: prepared.historyEntry,
      currentMessage: envelopeBody,
      formatEntry: (entry) =>
        formatAgentEnvelope({
          channel: "Matrix",
          from: roomLabel,
          timestamp: entry.timestamp,
          body: `${entry.sender}: ${entry.body} [id:${entry.messageId ?? "unknown"}]`,
        }),
    });
  }

  // Add reply context if present
  const replySuffix = replyTo
    ? `\n[Replying to message id:${replyTo}]`
    : "";
  if (replySuffix) {
    combinedBody = combinedBody + replySuffix;
  }

  // Build message context for dispatch
  const ctxPayload = {
    Body: combinedBody,
    RawBody: rawBody,
    CommandBody: rawBody,
    From: isDirect ? `matrix:dm:${sender}` : `matrix:room:${roomId}`,
    To: `matrix:${roomId}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    MessageSid: eventId,
    ReplyToId: replyTo,
    ChatType: isDirect ? "direct" : "group",
    GroupSubject: isDirect ? undefined : roomName,
    GroupRoom: isDirect ? undefined : roomId,
    SenderName: senderDisplayName ?? undefined,
    SenderId: sender,
    Provider: "matrix",
    Surface: "matrix",
    WasMentioned: prepared.wasMentioned,
    CommandAuthorized: prepared.commandAuthorized,
    OriginatingChannel: "matrix" as const,
    OriginatingTo: roomId,
  };

  if (shouldLogVerbose()) {
    const preview = envelopeBody.slice(0, 200).replace(/\n/g, "\\n");
    logVerbose(
      `matrix inbound: roomId=${roomId} from=${ctxPayload.From} len=${envelopeBody.length} preview="${preview}"`,
    );
  }

  // Send typing indicator before processing
  void sendMatrixTyping({
    client: ctx.client,
    roomId,
    typing: true,
    timeoutMs: 30_000,
  }).catch(() => {});

  // Resolve text chunk limit
  const textLimit = resolveTextChunkLimit(ctx.cfg, "matrix", ctx.accountId);

  // Track if we sent a reply
  let didSendReply = false;

  // Dispatch to agent with buffered block dispatcher
  const responsePrefix = resolveEffectiveMessagesConfig(
    ctx.cfg,
    route.agentId,
  ).responsePrefix;

  const { queuedFinal } = await dispatchReplyWithBufferedBlockDispatcher({
    ctx: ctxPayload,
    cfg: ctx.cfg,
    dispatcherOptions: {
      responsePrefix,
      deliver: async (payload: ReplyPayload, info) => {
        await deliverMatrixReply({
          ctx,
          roomId,
          payload,
          replyToId:
            ctx.replyToMode === "off"
              ? undefined
              : ctx.replyToMode === "first" && didSendReply
                ? undefined
                : eventId,
          replyToSender: sender,
          replyToBody: rawBody,
          textLimit,
        });
        didSendReply = true;
      },
      onError: (err, info) => {
        ctx.runtime.error?.(
          danger(`matrix ${info.kind} reply failed: ${String(err)}`),
        );
      },
      onReplyStart: async () => {
        // Refresh typing indicator when reply starts
        void sendMatrixTyping({
          client: ctx.client,
          roomId,
          typing: true,
          timeoutMs: 30_000,
        }).catch(() => {});
      },
    },
    replyOptions: {
      // Block streaming not yet implemented for Matrix
      disableBlockStreaming: true,
    },
  });

  // Stop typing indicator after processing
  void stopMatrixTyping({
    client: ctx.client,
    roomId,
  }).catch(() => {});

  // Clear history after successful reply in room context
  if (historyKey && ctx.historyLimit > 0 && didSendReply) {
    clearHistoryEntries({ historyMap: ctx.roomHistories, historyKey });
  }

  if (!queuedFinal) {
    logVerbose(
      "matrix: skipping reply - silent token or no text/media returned",
    );
    return false;
  }

  return didSendReply;
}

/**
 * Deliver a reply payload to a Matrix room.
 */
async function deliverMatrixReply(params: {
  ctx: MatrixPreflightContext["ctx"];
  roomId: string;
  payload: ReplyPayload;
  replyToId?: string;
  replyToSender?: string;
  replyToBody?: string;
  textLimit: number;
}): Promise<void> {
  const {
    ctx,
    roomId,
    payload,
    replyToId,
    replyToSender,
    replyToBody,
    textLimit,
  } = params;

  // Skip empty payloads
  if (!payload.text && !payload.mediaUrl && !payload.mediaUrls?.length) {
    ctx.runtime.error?.(danger("matrix: reply missing text/media"));
    return;
  }

  // Determine media list
  const mediaList = payload.mediaUrls?.length
    ? payload.mediaUrls
    : payload.mediaUrl
      ? [payload.mediaUrl]
      : [];

  // Send text-only replies
  if (mediaList.length === 0 && payload.text) {
    try {
      await sendMessageMatrix(roomId, payload.text, {
        client: ctx.client,
        replyTo: replyToId,
        replyToSender,
        replyToBody,
        textChunkLimit: textLimit,
        formatted: true,
      });

      recordChannelActivity({
        channel: "matrix",
        accountId: ctx.accountId,
        direction: "outbound",
      });

      if (shouldLogVerbose()) {
        logVerbose(`matrix: replied to ${roomId} with text`);
      }
    } catch (err) {
      throw new Error(`Failed to send Matrix text reply: ${String(err)}`);
    }
    return;
  }

  // Send media replies
  for (let i = 0; i < mediaList.length; i++) {
    const mediaUrl = mediaList[i];
    const isFirst = i === 0;
    const caption = isFirst ? payload.text : undefined;

    try {
      await sendMessageMatrix(roomId, caption ?? "", {
        client: ctx.client,
        replyTo: isFirst ? replyToId : undefined,
        replyToSender: isFirst ? replyToSender : undefined,
        replyToBody: isFirst ? replyToBody : undefined,
        mediaUrl,
        textChunkLimit: textLimit,
        formatted: true,
      });

      recordChannelActivity({
        channel: "matrix",
        accountId: ctx.accountId,
        direction: "outbound",
      });

      if (shouldLogVerbose()) {
        logVerbose(`matrix: replied to ${roomId} with media`);
      }
    } catch (err) {
      throw new Error(`Failed to send Matrix media reply: ${String(err)}`);
    }
  }
}

/**
 * Build sender label for envelope.
 */
function buildSenderLabel(params: {
  sender: string;
  displayName?: string;
}): string {
  const { sender, displayName } = params;
  if (displayName) {
    return `${displayName} (${sender})`;
  }
  return sender;
}

/**
 * Build room label for envelope.
 */
function buildRoomLabel(params: {
  roomId: string;
  roomName?: string;
  isDirect: boolean;
}): string {
  const { roomId, roomName, isDirect } = params;
  if (isDirect) {
    return `dm:${roomId}`;
  }
  if (roomName) {
    return `${roomName} (${roomId})`;
  }
  return `room:${roomId}`;
}
