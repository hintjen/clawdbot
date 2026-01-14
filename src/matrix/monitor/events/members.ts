/**
 * Matrix member event handler.
 * Handles m.room.member events for membership changes (joins, leaves, invites).
 *
 * Pattern follows Slack provider: separate file for member handling
 * with logging and invite detection.
 */

import { RoomMemberEvent } from "matrix-js-sdk";

import type { MatrixMonitorContext } from "../context.js";

/**
 * Parameters for registerMatrixMemberEvents.
 */
export type RegisterMatrixMemberEventsParams = {
  ctx: MatrixMonitorContext;
};

/**
 * Register Matrix member event handlers.
 *
 * Handles RoomMemberEvent.Membership for:
 * - Membership changes (join, leave, ban, invite)
 * - Bot invite detection
 * - Debug logging for membership transitions
 */
export function registerMatrixMemberEvents(
  params: RegisterMatrixMemberEventsParams,
): void {
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
        // Future: check allowFrom, groupPolicy before auto-joining
      }

      // Track joins to rooms the bot is in (could be used for notifications)
      if (
        newMembership === "join" &&
        oldMembership !== "join" &&
        userId !== ctx.botUserId
      ) {
        ctx.logger.debug(`user ${userId} joined ${roomId}`);
      }

      // Track leaves from rooms the bot is in
      if (
        newMembership === "leave" &&
        oldMembership === "join" &&
        userId !== ctx.botUserId
      ) {
        ctx.logger.debug(`user ${userId} left ${roomId}`);
      }
    } catch (err) {
      ctx.runtime.error?.(`matrix member handler error: ${String(err)}`);
    }
  });

  ctx.logger.debug("matrix member events registered");
}
