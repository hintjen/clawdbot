/**
 * Matrix typing event handler.
 * Handles incoming typing indicators from other users.
 *
 * Pattern follows Slack provider: separate file for typing handling
 * with optional logging for debugging.
 */

import { RoomMemberEvent } from "matrix-js-sdk";

import type { MatrixMonitorContext } from "../context.js";

/**
 * Parameters for registerMatrixTypingEvents.
 */
export type RegisterMatrixTypingEventsParams = {
  ctx: MatrixMonitorContext;
};

/**
 * Register Matrix typing event handlers.
 *
 * Handles RoomMemberEvent.Typing for:
 * - Logging when users start/stop typing (debug mode)
 * - Optional: future integration with typing status tracking
 *
 * Note: This handler is primarily for logging/debugging.
 * The bot's own typing indicators are sent via typing.ts (sendMatrixTyping).
 */
export function registerMatrixTypingEvents(
  params: RegisterMatrixTypingEventsParams,
): void {
  const { ctx } = params;

  ctx.client.on(RoomMemberEvent.Typing, (event, member) => {
    try {
      const roomId = event.getRoomId();
      const userId = member.userId;
      const isTyping = member.typing;

      if (!roomId || !userId) return;

      // Skip own typing events (bot self-filter)
      if (userId === ctx.botUserId) return;

      // Log typing status for debugging
      ctx.logger.debug(
        `typing: ${userId} in ${roomId} is ${isTyping ? "typing" : "idle"}`,
      );
    } catch (err) {
      ctx.runtime.error?.(`matrix typing handler error: ${String(err)}`);
    }
  });

  ctx.logger.debug("matrix typing events registered");
}
