/**
 * Matrix event handler registration.
 * Central entry point for registering all Matrix event handlers.
 *
 * Pattern follows Slack provider: single entry point that coordinates
 * registration of individual event types (messages, reactions, members, rooms).
 */

import { RoomStateEvent } from "matrix-js-sdk";
import type { MatrixMonitorContext } from "../context.js";
import { registerMatrixMemberEvents } from "./members.js";
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
  registerMatrixMemberEvents({ ctx });
  registerRoomEvents({ ctx });

  ctx.logger.debug("matrix event handlers registered");
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
