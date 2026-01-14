/**
 * Matrix action functions.
 * Standalone functions for all Matrix actions following Slack pattern.
 */

import type { MatrixClient } from "matrix-js-sdk";
import { EventType, MsgType, RelationType } from "matrix-js-sdk";
import { Direction } from "matrix-js-sdk/lib/models/event-timeline.js";
import type {
  ReactionEventContent,
  RoomMessageEventContent,
} from "matrix-js-sdk/lib/@types/events.js";

import { loadConfig } from "../config/config.js";
import { logVerbose } from "../globals.js";
import { resolveMatrixAccount } from "./accounts.js";
import {
  createMatrixClient,
  loginMatrix,
  stopMatrixClient,
} from "./client.js";
import { sendMessageMatrix } from "./send.js";
import type {
  MatrixActionOpts,
  MatrixMessageSummary,
  MatrixRoomInfo,
  MatrixUserProfile,
} from "./types.js";

/**
 * Get or create a Matrix client for action execution.
 * If a client is provided in opts, reuses it.
 * Otherwise, creates a new client and logs in.
 */
async function getClient(
  opts: MatrixActionOpts = {},
): Promise<{ client: MatrixClient; shouldStop: boolean }> {
  if (opts.client) {
    return { client: opts.client, shouldStop: false };
  }

  const cfg = loadConfig();
  const account = resolveMatrixAccount({ cfg, accountId: opts.accountId });

  if (!account.homeserver) {
    throw new Error(
      `Matrix homeserver not configured for account "${account.accountId}"`,
    );
  }

  if (!account.accessToken && !account.password) {
    throw new Error(
      `Matrix credentials not configured for account "${account.accountId}" (need accessToken or password)`,
    );
  }

  const client = createMatrixClient({
    homeserver: account.homeserver,
    userId: account.userId,
    accessToken: account.accessToken,
    deviceId: account.deviceId,
    storeType: "memory",
  });

  await loginMatrix(client, {
    userId: account.userId,
    accessToken: account.accessToken,
    password: account.password,
    deviceId: account.deviceId,
  });

  return { client, shouldStop: true };
}

/**
 * Helper to run an action with automatic client management.
 */
async function withClient<T>(
  opts: MatrixActionOpts,
  fn: (client: MatrixClient) => Promise<T>,
): Promise<T> {
  const { client, shouldStop } = await getClient(opts);
  try {
    return await fn(client);
  } finally {
    if (shouldStop) {
      await stopMatrixClient(client);
    }
  }
}

/**
 * Resolve the bot's user ID from the client.
 */
async function resolveBotUserId(client: MatrixClient): Promise<string> {
  const whoami = await client.whoami();
  if (!whoami?.user_id) {
    throw new Error("Failed to resolve Matrix bot user id");
  }
  return whoami.user_id;
}

// ============================================================================
// Reactions
// ============================================================================

/**
 * Normalize emoji to Matrix reaction format.
 * Keeps as-is for Unicode emoji, wraps shortcodes.
 */
function normalizeEmoji(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Emoji is required for Matrix reactions");
  }
  // Matrix uses raw Unicode emoji or shortcodes
  // Remove : wrapper if present for shortcodes
  return trimmed.replace(/^:+|:+$/g, "");
}

/**
 * Add a reaction to a Matrix message.
 */
export async function reactMatrixMessage(
  roomId: string,
  eventId: string,
  emoji: string,
  opts: MatrixActionOpts = {},
): Promise<void> {
  const key = normalizeEmoji(emoji);
  await withClient(opts, async (client) => {
    // Matrix reactions use m.reaction event type with m.relates_to
    const content: ReactionEventContent = {
      "m.relates_to": {
        rel_type: RelationType.Annotation,
        event_id: eventId,
        key,
      },
    };
    await client.sendEvent(roomId, EventType.Reaction, content);
    logVerbose(`matrix: added reaction "${key}" to ${eventId} in ${roomId}`);
  });
}

/**
 * Remove a reaction from a Matrix message.
 * Finds and redacts the reaction event.
 */
export async function removeMatrixReaction(
  roomId: string,
  eventId: string,
  emoji: string,
  opts: MatrixActionOpts = {},
): Promise<void> {
  const key = normalizeEmoji(emoji);
  await withClient(opts, async (client) => {
    const userId = await resolveBotUserId(client);

    // Fetch reactions using the relations API
    const response = await client.relations(
      roomId,
      eventId,
      RelationType.Annotation,
      EventType.Reaction,
    );

    if (!response.events || response.events.length === 0) {
      logVerbose(`matrix: no reactions found for ${eventId}`);
      return;
    }

    // Find our reaction with the specific emoji
    for (const ev of response.events) {
      if (ev.getSender() === userId) {
        const content = ev.getContent() as { "m.relates_to"?: { key?: string } };
        if (content?.["m.relates_to"]?.key === key) {
          const reactionEventId = ev.getId();
          if (reactionEventId) {
            await client.redactEvent(roomId, reactionEventId);
            logVerbose(`matrix: removed reaction "${key}" from ${eventId}`);
            return;
          }
        }
      }
    }

    logVerbose(`matrix: reaction "${key}" not found on ${eventId}`);
  });
}

/**
 * Remove all own reactions from a Matrix message.
 */
export async function removeOwnMatrixReactions(
  roomId: string,
  eventId: string,
  opts: MatrixActionOpts = {},
): Promise<string[]> {
  return await withClient(opts, async (client) => {
    const userId = await resolveBotUserId(client);

    // Fetch reactions using the relations API
    const response = await client.relations(
      roomId,
      eventId,
      RelationType.Annotation,
      EventType.Reaction,
    );

    if (!response.events || response.events.length === 0) {
      return [];
    }

    const removed: string[] = [];
    const toRedact: string[] = [];

    for (const ev of response.events) {
      if (ev.getSender() === userId) {
        const evId = ev.getId();
        const content = ev.getContent() as { "m.relates_to"?: { key?: string } };
        const key = content?.["m.relates_to"]?.key;
        if (evId && key) {
          toRedact.push(evId);
          removed.push(key);
        }
      }
    }

    await Promise.all(toRedact.map((id) => client.redactEvent(roomId, id)));

    if (removed.length > 0) {
      logVerbose(`matrix: removed ${removed.length} reactions from ${eventId}`);
    }

    return removed;
  });
}

/**
 * List reactions on a Matrix message.
 */
export async function listMatrixReactions(
  roomId: string,
  eventId: string,
  opts: MatrixActionOpts = {},
): Promise<MatrixMessageSummary["reactions"]> {
  return await withClient(opts, async (client) => {
    // Fetch reactions using the relations API
    const response = await client.relations(
      roomId,
      eventId,
      RelationType.Annotation,
      EventType.Reaction,
    );

    if (!response.events || response.events.length === 0) {
      return [];
    }

    // Aggregate reactions by key
    const reactionMap = new Map<string, { count: number; senders: string[] }>();

    for (const ev of response.events) {
      const content = ev.getContent() as { "m.relates_to"?: { key?: string } };
      const key = content?.["m.relates_to"]?.key;
      const sender = ev.getSender();
      if (key && sender) {
        const existing = reactionMap.get(key);
        if (existing) {
          existing.count++;
          existing.senders.push(sender);
        } else {
          reactionMap.set(key, { count: 1, senders: [sender] });
        }
      }
    }

    return Array.from(reactionMap.entries()).map(([key, data]) => ({
      key,
      count: data.count,
      senders: data.senders,
    }));
  });
}

// ============================================================================
// Messages
// ============================================================================

/**
 * Send a message to a Matrix room.
 * Alias for sendMessageMatrix from send.ts.
 */
export async function sendMatrixMessage(
  roomId: string,
  body: string,
  opts: MatrixActionOpts & { mediaUrl?: string; replyTo?: string } = {},
): Promise<{ eventId: string; roomId: string }> {
  return await sendMessageMatrix(roomId, body, {
    accountId: opts.accountId,
    client: opts.client,
    mediaUrl: opts.mediaUrl,
    replyTo: opts.replyTo,
  });
}

/**
 * Edit a Matrix message.
 */
export async function editMatrixMessage(
  roomId: string,
  eventId: string,
  newBody: string,
  opts: MatrixActionOpts = {},
): Promise<void> {
  await withClient(opts, async (client) => {
    // Matrix message edits use m.replace relation
    // RoomMessageEventContent uses complex XOR types that don't directly
    // support the edit structure, so we cast through unknown
    const content = {
      body: `* ${newBody}`,
      msgtype: MsgType.Text,
      "m.new_content": {
        body: newBody,
        msgtype: MsgType.Text,
      },
      "m.relates_to": {
        rel_type: RelationType.Replace,
        event_id: eventId,
      },
    } as unknown as RoomMessageEventContent;
    await client.sendEvent(roomId, EventType.RoomMessage, content);
    logVerbose(`matrix: edited message ${eventId} in ${roomId}`);
  });
}

/**
 * Delete (redact) a Matrix message.
 */
export async function deleteMatrixMessage(
  roomId: string,
  eventId: string,
  opts: MatrixActionOpts & { reason?: string } = {},
): Promise<void> {
  await withClient(opts, async (client) => {
    await client.redactEvent(roomId, eventId, undefined, {
      reason: opts.reason,
    });
    logVerbose(`matrix: deleted message ${eventId} in ${roomId}`);
  });
}

/**
 * Read message history from a Matrix room.
 */
export async function readMatrixMessages(
  roomId: string,
  opts: MatrixActionOpts & {
    limit?: number;
    from?: string;
  } = {},
): Promise<{ messages: MatrixMessageSummary[]; end?: string }> {
  return await withClient(opts, async (client) => {
    const limit = opts.limit ?? 50;

    // Use createMessagesRequest for room history
    // The from parameter must be a string or null, not undefined
    const response = await client.createMessagesRequest(
      roomId,
      opts.from ?? null,
      limit,
      Direction.Backward,
    );

    const messages: MatrixMessageSummary[] = [];

    for (const event of response.chunk ?? []) {
      if (event.type !== "m.room.message") continue;

      const content = event.content as Record<string, unknown> | undefined;
      messages.push({
        eventId: event.event_id ?? "",
        sender: event.sender ?? "",
        body: (content?.body as string) ?? undefined,
        formattedBody: (content?.formatted_body as string) ?? undefined,
        timestamp: event.origin_server_ts ?? 0,
        threadRoot: (
          content?.["m.relates_to"] as { event_id?: string } | undefined
        )?.event_id,
      });
    }

    return {
      messages,
      end: response.end,
    };
  });
}

// ============================================================================
// Read Receipts
// ============================================================================

/**
 * Send a read receipt for a Matrix message.
 */
export async function sendMatrixReadReceipt(
  roomId: string,
  eventId: string,
  opts: MatrixActionOpts = {},
): Promise<void> {
  await withClient(opts, async (client) => {
    const room = client.getRoom(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found in client cache`);
    }

    // Get the event from the room timeline
    const event = room.findEventById(eventId);
    if (!event) {
      throw new Error(`Event ${eventId} not found in room ${roomId}`);
    }

    await client.sendReadReceipt(event);
    logVerbose(`matrix: sent read receipt for ${eventId} in ${roomId}`);
  });
}

// ============================================================================
// Room Management
// ============================================================================

/**
 * Join a Matrix room by ID or alias.
 */
export async function joinMatrixRoom(
  roomIdOrAlias: string,
  opts: MatrixActionOpts = {},
): Promise<{ roomId: string }> {
  return await withClient(opts, async (client) => {
    const response = await client.joinRoom(roomIdOrAlias);
    const roomId = response.roomId;
    logVerbose(`matrix: joined room ${roomId}`);
    return { roomId };
  });
}

/**
 * Leave a Matrix room.
 */
export async function leaveMatrixRoom(
  roomId: string,
  opts: MatrixActionOpts = {},
): Promise<void> {
  await withClient(opts, async (client) => {
    await client.leave(roomId);
    logVerbose(`matrix: left room ${roomId}`);
  });
}

/**
 * Invite a user to a Matrix room.
 */
export async function inviteToMatrixRoom(
  roomId: string,
  userId: string,
  opts: MatrixActionOpts = {},
): Promise<void> {
  await withClient(opts, async (client) => {
    await client.invite(roomId, userId);
    logVerbose(`matrix: invited ${userId} to ${roomId}`);
  });
}

// ============================================================================
// User/Room Info
// ============================================================================

/**
 * Get a user's profile information.
 */
export async function getMatrixUserProfile(
  userId: string,
  opts: MatrixActionOpts = {},
): Promise<MatrixUserProfile> {
  return await withClient(opts, async (client) => {
    const profile = await client.getProfileInfo(userId);
    return {
      userId,
      displayName: profile.displayname ?? undefined,
      avatarUrl: profile.avatar_url ?? undefined,
    };
  });
}

/**
 * Get room member list.
 */
export async function getMatrixRoomMembers(
  roomId: string,
  opts: MatrixActionOpts = {},
): Promise<MatrixUserProfile[]> {
  return await withClient(opts, async (client) => {
    const room = client.getRoom(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found in client cache`);
    }

    const members = room.getJoinedMembers();
    return members.map((m) => ({
      userId: m.userId,
      displayName: m.name ?? undefined,
      avatarUrl: m.getMxcAvatarUrl() ?? undefined,
    }));
  });
}

/**
 * Get room information.
 */
export async function getMatrixRoomInfo(
  roomId: string,
  opts: MatrixActionOpts = {},
): Promise<MatrixRoomInfo> {
  return await withClient(opts, async (client) => {
    const room = client.getRoom(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found in client cache`);
    }

    return {
      roomId,
      name: room.name ?? undefined,
      topic: room.currentState.getStateEvents("m.room.topic", "")?.getContent()
        ?.topic as string | undefined,
      memberCount: room.getJoinedMemberCount(),
      isEncrypted: room.hasEncryptionStateEvent(),
      isDirect: room.getDMInviter() !== undefined || false,
    };
  });
}
