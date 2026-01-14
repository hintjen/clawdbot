/**
 * Matrix message preflight checks.
 *
 * Validates incoming messages before processing:
 * - Filter bot's own messages
 * - Check DM policy and allowlist
 * - Check room policy and allowlist
 * - Check mention requirements
 * - Handle pairing for unauthorized DM senders
 */

import type { HistoryEntry } from "../../../auto-reply/reply/history.js";
import {
  buildMentionRegexes,
  matchesMentionPatterns,
} from "../../../auto-reply/reply/mentions.js";
import { logVerbose, shouldLogVerbose } from "../../../globals.js";
import { recordChannelActivity } from "../../../infra/channel-activity.js";
import { buildPairingReply } from "../../../pairing/pairing-messages.js";
import {
  readChannelAllowFromStore,
  upsertChannelPairingRequest,
} from "../../../pairing/pairing-store.js";
import { resolveAgentRoute } from "../../../routing/resolve-route.js";
import { containsMatrixMention } from "../../format.js";
import { sendMessageMatrix } from "../../send.js";
import {
  allowListMatchesUser,
  isMatrixRoomAllowed,
  isMatrixRoomUserAllowed,
  normalizeMatrixAllowList,
  resolveMatrixRoomConfig,
  resolveMatrixShouldRequireMention,
  type MatrixRoomConfigResolved,
} from "../allow-list.js";
import type { MatrixMonitorContext } from "../context.js";
import type { MatrixMessageHandler } from "../events/types.js";

/**
 * Input parameters for Matrix message preflight.
 */
export type MatrixPreflightParams = {
  ctx: MatrixMonitorContext;
  message: Parameters<MatrixMessageHandler>[0];
  meta: Parameters<MatrixMessageHandler>[1];
};

/**
 * Result of successful preflight - prepared context for processing.
 */
export type MatrixPreflightContext = {
  ctx: MatrixMonitorContext;
  message: Parameters<MatrixMessageHandler>[0];
  meta: Parameters<MatrixMessageHandler>[1];

  /** Whether this is a direct message (1:1 room). */
  isDirect: boolean;
  /** Resolved room name if available. */
  roomName?: string;
  /** Resolved room alias if available. */
  roomAlias?: string;
  /** Sender display name if available. */
  senderDisplayName?: string;

  /** Resolved agent route for session key. */
  route: ReturnType<typeof resolveAgentRoute>;
  /** Resolved room config (if applicable). */
  roomConfig: MatrixRoomConfigResolved | null;

  /** Whether the bot was mentioned in the message. */
  wasMentioned: boolean;
  /** Whether user is authorized for commands. */
  commandAuthorized: boolean;

  /** History entry for this message (if applicable). */
  historyEntry?: HistoryEntry;
};

/**
 * Run preflight checks on an incoming Matrix message.
 *
 * @returns Prepared context if message should be processed, null to skip.
 */
export async function preflightMatrixMessage(
  params: MatrixPreflightParams,
): Promise<MatrixPreflightContext | null> {
  const { ctx, message, meta } = params;
  const { roomId, sender, body, eventId, timestamp } = message;

  // Always filter bot's own messages to prevent self-reply loops
  if (sender === ctx.botUserId) {
    logVerbose(`matrix: drop own message eventId=${eventId}`);
    return null;
  }

  // Check if message was already seen (dedupe)
  if (ctx.markMessageSeen(roomId, eventId)) {
    logVerbose(`matrix: drop duplicate eventId=${eventId}`);
    return null;
  }

  // Resolve room info
  const roomInfo = await ctx.resolveRoomInfo(roomId);
  const isDirect = roomInfo.isDirect ?? false;
  const roomName = roomInfo.name;

  // Get sender display name
  const senderInfo = await ctx.resolveUserDisplayName(sender);
  const senderDisplayName = senderInfo.displayName;

  // Record inbound activity
  recordChannelActivity({
    channel: "matrix",
    accountId: ctx.accountId,
    direction: "inbound",
  });

  if (shouldLogVerbose()) {
    logVerbose(
      `matrix: inbound eventId=${eventId} room=${roomId} sender=${sender} isDirect=${isDirect ? "yes" : "no"} mention=${meta.wasMentioned ? "yes" : "no"}`,
    );
  }

  // === DM Policy Checks ===
  let commandAuthorized = true;
  if (isDirect) {
    // Check if DMs are enabled
    if (!ctx.dmEnabled) {
      logVerbose("matrix: drop dm (dms disabled)");
      return null;
    }

    // Check DM policy
    const dmPolicy = ctx.dmPolicy;
    if (dmPolicy === "disabled") {
      logVerbose("matrix: drop dm (dmPolicy: disabled)");
      return null;
    }

    if (dmPolicy !== "open") {
      // Check allowlist (config + pairing store)
      const storeAllowFrom = await readChannelAllowFromStore("matrix").catch(
        () => [],
      );
      const effectiveAllowFrom = [...ctx.allowFrom, ...storeAllowFrom];
      const allowList = normalizeMatrixAllowList(effectiveAllowFrom);
      const permitted = allowListMatchesUser(sender, allowList);

      if (!permitted) {
        commandAuthorized = false;

        if (dmPolicy === "pairing") {
          // Create pairing request
          const { code, created } = await upsertChannelPairingRequest({
            channel: "matrix",
            id: sender,
            meta: {
              displayName: senderDisplayName ?? undefined,
            },
          });

          if (created) {
            logVerbose(
              `matrix pairing request sender=${sender} displayName=${senderDisplayName ?? "unknown"}`,
            );
            try {
              await sendMessageMatrix(roomId, buildPairingReply({
                channel: "matrix",
                idLine: `Your Matrix user ID: ${sender}`,
                code,
              }), {
                client: ctx.client,
              });
            } catch (err) {
              logVerbose(
                `matrix pairing reply failed for ${sender}: ${String(err)}`,
              );
            }
          }
        } else {
          logVerbose(
            `Blocked unauthorized matrix sender ${sender} (dmPolicy=${dmPolicy})`,
          );
        }
        return null;
      }
      commandAuthorized = true;
    }
  }

  // === Room Policy Checks ===
  let roomConfig: MatrixRoomConfigResolved | null = null;
  if (!isDirect) {
    // Check if room is allowed
    if (
      !isMatrixRoomAllowed({
        roomId,
        roomName,
        roomsConfig: ctx.roomsConfig,
        groupPolicy: ctx.groupPolicy,
      })
    ) {
      if (ctx.groupPolicy === "disabled") {
        logVerbose("matrix: drop room message (groupPolicy: disabled)");
      } else {
        logVerbose(
          `Blocked matrix room ${roomId} (not in room allowlist, groupPolicy: ${ctx.groupPolicy})`,
        );
      }
      return null;
    }

    // Resolve room-specific config
    roomConfig = resolveMatrixRoomConfig({
      roomId,
      roomName,
      roomsConfig: ctx.roomsConfig,
    });

    // Check if room is disabled
    if (roomConfig?.enabled === false) {
      logVerbose(`Blocked matrix room ${roomId} (room disabled)`);
      return null;
    }

    // Check per-room user allowlist
    if (!isMatrixRoomUserAllowed({ userId: sender, roomConfig })) {
      logVerbose(
        `Blocked matrix sender ${sender} in room ${roomId} (not in room users allowlist)`,
      );
      return null;
    }

    // For rooms, authorize commands based on room user list
    commandAuthorized = isMatrixRoomUserAllowed({ userId: sender, roomConfig });
  }

  // === Resolve Agent Route ===
  const route = resolveAgentRoute({
    cfg: ctx.cfg,
    channel: "matrix",
    accountId: ctx.accountId,
    peer: {
      kind: isDirect ? "dm" : "channel",
      id: isDirect ? sender : roomId,
    },
  });

  // === Mention Detection ===
  // Check if bot was mentioned in the message
  const mentionRegexes = buildMentionRegexes(ctx.cfg, route.agentId);
  const wasMentionedByUserId = containsMatrixMention(body, ctx.botUserId);
  const wasMentionedByPattern = matchesMentionPatterns(body, mentionRegexes);
  const wasMentioned =
    meta.wasMentioned || wasMentionedByUserId || wasMentionedByPattern;

  // === Mention Requirement Check ===
  if (!isDirect) {
    const shouldRequireMention = resolveMatrixShouldRequireMention({
      isDirect,
      roomConfig,
    });

    if (shouldRequireMention && !wasMentioned) {
      logVerbose(
        `matrix: drop room message (mention required, not mentioned)`,
      );
      return null;
    }
  }

  // === Build History Entry ===
  let historyEntry: HistoryEntry | undefined;
  if (!isDirect && ctx.historyLimit > 0 && body) {
    historyEntry = {
      sender: senderDisplayName ?? sender,
      body,
      timestamp,
      messageId: eventId,
    };
  }

  // === Skip Empty Messages ===
  if (!body || !body.trim()) {
    logVerbose(`matrix: drop message ${eventId} (empty content)`);
    return null;
  }

  return {
    ctx,
    message,
    meta,
    isDirect,
    roomName,
    senderDisplayName,
    route,
    roomConfig,
    wasMentioned,
    commandAuthorized,
    historyEntry,
  };
}
