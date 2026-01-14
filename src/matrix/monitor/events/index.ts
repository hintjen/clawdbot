/**
 * Matrix event handler registration.
 * Central entry point for registering all Matrix event handlers.
 *
 * Pattern follows Slack provider: single entry point that coordinates
 * registration of individual event types (messages, reactions, members, rooms).
 */

import type { MatrixMonitorContext } from "../context.js";
import { registerMatrixMemberEvents } from "./members.js";
import { registerMatrixMessageEvents } from "./messages.js";
import { registerMatrixReactionEvents } from "./reactions.js";
import { registerMatrixRoomEvents } from "./rooms.js";
import { registerMatrixTypingEvents } from "./typing.js";
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
  registerMatrixRoomEvents({ ctx });
  registerMatrixTypingEvents({ ctx });

  ctx.logger.debug("matrix event handlers registered");
}
