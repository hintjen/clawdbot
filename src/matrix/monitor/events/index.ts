/**
 * Matrix event handler registration.
 * Central entry point for registering all Matrix event handlers.
 *
 * Pattern follows Slack provider: single entry point that coordinates
 * registration of individual event types (messages, reactions, members, rooms).
 */

import { RoomEvent, RoomMemberEvent, RoomStateEvent } from "matrix-js-sdk";
import type { MatrixMonitorContext } from "../context.js";
import { registerMatrixMessageEvents } from "./messages.js";
import type { MatrixMessageHandler } from "./types.js";

// Re-export types for convenience
export type { MatrixMessageHandler } from "./types.js";

/**
 * Parameters for registerMatrixEvents().
 */
export type RegisterMatrixEventsParams = {
  /** Matrix monitor context with client and config. */
  ctx: MatrixMonitorContext;
  /** Handler for incoming messages. */
  handleMatrixMessage: MatrixMessageHandler;
};

/**
 * Register all Matrix event handlers.
 *
 * This is the main entry point called by the monitor provider after
 * client login and before starting the sync loop.
 *
 * Event types registered:
 * - Room.timeline: Incoming messages (m.room.message)
 * - Room.redaction: Message deletions
 * - RoomMember.typing: Typing indicators
 * - RoomState.events: Room state changes (invites, tombstones)
 */
export function registerMatrixEvents(params: RegisterMatrixEventsParams): void {
  const { ctx, handleMatrixMessage } = params;

  ctx.logger.debug("registering matrix event handlers");

  // Register individual event handlers from separate files
  registerMatrixMessageEvents({ ctx, handleMatrixMessage });
  registerReactionEvents({ ctx });
  registerMemberEvents({ ctx });
  registerRoomEvents({ ctx });

  ctx.logger.debug("matrix event handlers registered");
}

/**
 * Register reaction event handlers.
 * Handles m.reaction events for emoji reactions.
 */
function registerReactionEvents(params: { ctx: MatrixMonitorContext }): void {
  const { ctx } = params;

  ctx.client.on(RoomEvent.Timeline, async (event, room) => {
    try {
      const eventType = event.getType();
      if (eventType !== "m.reaction") return;

      // Skip if no room
      if (!room) return;

      const roomId = room.roomId;
      const eventId = event.getId();
      const sender = event.getSender();
      const timestamp = event.getTs();

      // Skip if missing required fields
      if (!eventId || !sender) return;

      // Skip own reactions
      if (sender === ctx.botUserId) return;

      // Extract reaction content
      const content = event.getContent();
      const relatesTo = content["m.relates_to"] as
        | { event_id?: string; key?: string; rel_type?: string }
        | undefined;

      if (relatesTo?.rel_type !== "m.annotation") return;

      const targetEventId = relatesTo?.event_id;
      const key = relatesTo?.key;

      if (!targetEventId || !key) return;

      // Check reaction notification settings
      if (ctx.reactionMode === "off") return;

      // For "own" mode, only notify on reactions to bot's own messages
      if (ctx.reactionMode === "own") {
        // Would need to check if targetEventId is from bot
        // For now, skip this check - will be refined in message handler
      }

      // For "allowlist" mode, check if key is in allowlist
      if (ctx.reactionMode === "allowlist") {
        if (!ctx.reactionAllowlist.includes(key)) return;
      }

      ctx.logger.debug(
        `reaction ${key} on ${targetEventId} in ${roomId} by ${sender}`,
      );

      // Reaction notifications can be routed to session via system events
      // This is handled by enqueueSystemEvent in the full implementation
    } catch (err) {
      ctx.runtime.error?.(`matrix reaction handler error: ${String(err)}`);
    }
  });

  ctx.logger.debug("matrix reaction events registered");
}

/**
 * Register member event handlers.
 * Handles m.room.member events for joins/leaves.
 */
function registerMemberEvents(params: { ctx: MatrixMonitorContext }): void {
  const { ctx } = params;

  ctx.client.on(RoomMemberEvent.Membership, (event, member, oldMembership) => {
    try {
      const roomId = event.getRoomId();
      const userId = member.userId;
      const newMembership = member.membership;

      if (!roomId || !userId) return;

      // Log membership changes for debugging
      if (oldMembership !== newMembership) {
        ctx.logger.debug(
          `member ${userId} in ${roomId}: ${oldMembership ?? "none"} -> ${newMembership}`,
        );
      }

      // Handle invites to the bot
      if (userId === ctx.botUserId && newMembership === "invite") {
        ctx.logger.info(`bot invited to room ${roomId}`);
        // Auto-join logic could go here based on config
      }
    } catch (err) {
      ctx.runtime.error?.(`matrix member handler error: ${String(err)}`);
    }
  });

  ctx.logger.debug("matrix member events registered");
}

/**
 * Register room event handlers.
 * Handles room state events (invites, upgrades, etc.).
 */
function registerRoomEvents(params: { ctx: MatrixMonitorContext }): void {
  const { ctx } = params;

  ctx.client.on(RoomStateEvent.Events, (event, state) => {
    try {
      const eventType = event.getType();
      const roomId = state?.roomId;

      if (!roomId) return;

      // Handle room tombstones (room upgrades)
      if (eventType === "m.room.tombstone") {
        const content = event.getContent();
        const replacementRoom = content.replacement_room as string | undefined;
        ctx.logger.info(
          `room ${roomId} tombstoned, replacement: ${replacementRoom ?? "none"}`,
        );
        // Could auto-join replacement room here
      }
    } catch (err) {
      ctx.runtime.error?.(`matrix room handler error: ${String(err)}`);
    }
  });

  ctx.logger.debug("matrix room events registered");
}
