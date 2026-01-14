/**
 * Matrix event handler registration.
 * Central entry point for registering all Matrix event handlers.
 *
 * Pattern follows Slack provider: single entry point that coordinates
 * registration of individual event types (messages, reactions, members, rooms).
 */

import { RoomMemberEvent, RoomStateEvent } from "matrix-js-sdk";
import type { MatrixMonitorContext } from "../context.js";
import { registerMatrixMessageEvents } from "./messages.js";
import { registerMatrixReactionEvents } from "./reactions.js";
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
  registerMatrixReactionEvents({ ctx });
  registerMemberEvents({ ctx });
  registerRoomEvents({ ctx });

  ctx.logger.debug("matrix event handlers registered");
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
