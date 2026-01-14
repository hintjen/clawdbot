/**
 * Matrix reaction event handler.
 * Handles m.reaction events for emoji reactions.
 *
 * Pattern follows Slack provider: separate file for reaction handling
 * with filtering, allowlist checking, and system event notifications.
 */

import { RoomEvent } from "matrix-js-sdk";

import { enqueueSystemEvent } from "../../../infra/system-events.js";
import { shouldEmitMatrixReactionNotification } from "../allow-list.js";
import type { MatrixMonitorContext } from "../context.js";
import { resolveMatrixRoomLabel } from "../room-config.js";

/**
 * Parameters for registerMatrixReactionEvents.
 */
export type RegisterMatrixReactionEventsParams = {
  ctx: MatrixMonitorContext;
};

/**
 * Register Matrix reaction event handlers.
 *
 * Handles m.reaction events from Room.timeline:
 * - Filters by reactionMode setting
 * - Checks allowlist when mode is "allowlist"
 * - Emits system event notifications
 */
export function registerMatrixReactionEvents(
  params: RegisterMatrixReactionEventsParams,
): void {
  const { ctx } = params;

  ctx.client.on(RoomEvent.Timeline, async (event, room, toStartOfTimeline) => {
    try {
      // Skip historical events (initial sync backfill)
      if (toStartOfTimeline) return;

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

      // Skip own reactions (bot self-filter)
      if (sender === ctx.botUserId) return;

      // Extract reaction content (m.relates_to.m.annotation)
      const content = event.getContent();
      const relatesTo = content["m.relates_to"] as
        | { event_id?: string; key?: string; rel_type?: string }
        | undefined;

      // Matrix reactions use rel_type: "m.annotation"
      if (relatesTo?.rel_type !== "m.annotation") return;

      const targetEventId = relatesTo?.event_id;
      const key = relatesTo?.key;

      if (!targetEventId || !key) return;

      // Check room permissions
      const roomInfo = await ctx.resolveRoomInfo(roomId);
      const isDirect = roomInfo.isDirect ?? room.getJoinedMemberCount() === 2;

      if (!ctx.isRoomAllowed({ roomId, isDirect })) {
        ctx.logger.debug(`skipping reaction from disallowed room ${roomId}`);
        return;
      }

      // Determine the author of the target message (for "own" mode check)
      let targetMessageAuthorId: string | undefined;
      try {
        const targetEvent = room.findEventById(targetEventId);
        if (targetEvent) {
          targetMessageAuthorId = targetEvent.getSender() ?? undefined;
        }
      } catch {
        // Failed to find target event, proceed without author info
      }

      // Check if we should emit notification based on settings
      const shouldNotify = shouldEmitMatrixReactionNotification({
        mode: ctx.reactionMode,
        botUserId: ctx.botUserId,
        messageAuthorId: targetMessageAuthorId,
        reactorUserId: sender,
        reactionAllowlist: ctx.reactionAllowlist,
      });

      if (!shouldNotify) {
        ctx.logger.debug(
          `skipping reaction notification: mode=${ctx.reactionMode}`,
        );
        return;
      }

      // Build notification text
      const roomLabel = resolveMatrixRoomLabel({
        roomId,
        roomName: roomInfo.name,
      });

      // Resolve actor display name
      const actorInfo = await ctx.resolveUserDisplayName(sender);
      const actorLabel = actorInfo.displayName ?? sender;

      // Build system event text
      const text = `Matrix reaction: ${key} by ${actorLabel} in ${roomLabel} (msg ${targetEventId.slice(0, 16)}...)`;

      // Resolve session key for system event routing
      const sessionKey = ctx.resolveMatrixSystemEventSessionKey({
        roomId,
        isDirect,
      });

      // Emit system event
      enqueueSystemEvent(text, {
        sessionKey,
        contextKey: `matrix:reaction:${roomId}:${targetEventId}:${sender}:${key}`,
      });

      ctx.logger.debug(
        `reaction ${key} on ${targetEventId} in ${roomId} by ${sender}`,
      );
    } catch (err) {
      ctx.runtime.error?.(`matrix reaction handler error: ${String(err)}`);
    }
  });

  ctx.logger.debug("matrix reaction events registered");
}
