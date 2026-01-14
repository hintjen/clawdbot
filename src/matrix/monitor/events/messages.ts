/**
 * Matrix message event handler.
 * Handles m.room.message events from Room.timeline.
 *
 * Pattern follows Slack provider: separate file for message handling
 * with filtering, deduplication, and non-blocking dispatch.
 */

import { RoomEvent } from "matrix-js-sdk";

import { enqueueSystemEvent } from "../../../infra/system-events.js";
import type { MatrixMonitorContext } from "../context.js";
import { resolveMatrixRoomLabel } from "../room-config.js";
import type { MatrixMessageHandler } from "./types.js";

/**
 * Parameters for registerMatrixMessageEvents.
 */
export type RegisterMatrixMessageEventsParams = {
  ctx: MatrixMonitorContext;
  handleMatrixMessage: MatrixMessageHandler;
};

/**
 * Register Matrix message event handlers.
 *
 * Handles:
 * - m.room.message: New messages
 * - m.room.message with m.relates_to.m.replace: Edits
 * - m.room.redaction: Message deletions (handled separately)
 */
export function registerMatrixMessageEvents(
  params: RegisterMatrixMessageEventsParams,
): void {
  const { ctx, handleMatrixMessage } = params;

  ctx.client.on(
    RoomEvent.Timeline,
    async (event, room, toStartOfTimeline, removed, data) => {
      try {
        // Skip historical messages (initial sync backfill)
        if (toStartOfTimeline) return;
        if (data.liveEvent === false) return;

        // Skip if no room (shouldn't happen)
        if (!room) return;

        const eventType = event.getType();
        const roomId = room.roomId;
        const eventId = event.getId();
        const sender = event.getSender();
        const timestamp = event.getTs();

        // Only handle message events
        if (eventType !== "m.room.message") return;

        // Skip if missing required fields
        if (!eventId || !sender) return;

        // Skip own messages (bot self-filter)
        if (sender === ctx.botUserId) return;

        // Extract message content
        const content = event.getContent();
        const body = content.body ?? "";
        const formattedBody = content.formatted_body as string | undefined;
        const msgtype = content.msgtype ?? "m.text";

        // Extract relations for edits and replies
        const relatesTo = content["m.relates_to"] as
          | {
              "m.in_reply_to"?: { event_id?: string };
              rel_type?: string;
              event_id?: string;
            }
          | undefined;

        // Check if this is an edit (replacement)
        const isEdit = relatesTo?.rel_type === "m.replace";
        if (isEdit) {
          await handleEditEvent({
            ctx,
            roomId,
            eventId,
            sender,
            targetEventId: relatesTo?.event_id,
            timestamp,
          });
          return;
        }

        // Check dedupe (already seen this event?)
        if (ctx.markMessageSeen(roomId, eventId)) {
          ctx.logger.debug(`skipping duplicate event ${eventId}`);
          return;
        }

        // Extract reply context
        const replyTo = relatesTo?.["m.in_reply_to"]?.event_id;

        // Check room/DM permissions - need to resolve room info first
        const roomInfo = await ctx.resolveRoomInfo(roomId);
        const isDirect = roomInfo.isDirect ?? room.getJoinedMemberCount() === 2;

        if (!ctx.isRoomAllowed({ roomId, isDirect })) {
          ctx.logger.debug(`skipping message from disallowed room ${roomId}`);
          return;
        }

        // Dispatch to message handler (non-blocking)
        handleMatrixMessage(
          {
            eventId,
            roomId,
            sender,
            body,
            formattedBody,
            msgtype,
            replyTo,
            timestamp,
          },
          { source: "timeline" },
        ).catch((err) => {
          ctx.runtime.error?.(
            `matrix message handler failed: ${String(err)}`,
          );
        });
      } catch (err) {
        ctx.runtime.error?.(`matrix timeline handler error: ${String(err)}`);
      }
    },
  );

  // Register redaction handler (message deletions)
  registerRedactionHandler({ ctx });

  ctx.logger.debug("matrix message events registered");
}

/**
 * Handle message edit events.
 * Emits a system event notification for edits.
 */
async function handleEditEvent(params: {
  ctx: MatrixMonitorContext;
  roomId: string;
  eventId: string;
  sender: string;
  targetEventId?: string;
  timestamp: number;
}): Promise<void> {
  const { ctx, roomId, eventId, sender, targetEventId, timestamp } = params;

  // Check room permissions
  const roomInfo = await ctx.resolveRoomInfo(roomId);
  const isDirect = roomInfo.isDirect ?? false;

  if (!ctx.isRoomAllowed({ roomId, isDirect })) {
    return;
  }

  const label = resolveMatrixRoomLabel({
    roomId,
    roomName: roomInfo.name,
  });

  const sessionKey = ctx.resolveMatrixSystemEventSessionKey({
    roomId,
    isDirect,
  });

  enqueueSystemEvent(`Matrix message edited in ${label}.`, {
    sessionKey,
    contextKey: `matrix:message:edited:${roomId}:${targetEventId ?? eventId}`,
  });

  ctx.logger.debug(
    `message edit in ${roomId} by ${sender}: ${targetEventId ?? eventId}`,
  );
}

/**
 * Register redaction handler for message deletions.
 */
function registerRedactionHandler(params: { ctx: MatrixMonitorContext }): void {
  const { ctx } = params;

  ctx.client.on(RoomEvent.Redaction, async (event, room) => {
    try {
      if (!room) return;

      const roomId = room.roomId;
      const sender = event.getSender();
      const redactedEventId = event.getAssociatedId();

      if (!sender || !redactedEventId) return;

      // Skip own redactions
      if (sender === ctx.botUserId) return;

      // Check room permissions
      const roomInfo = await ctx.resolveRoomInfo(roomId);
      const isDirect = roomInfo.isDirect ?? room.getJoinedMemberCount() === 2;

      if (!ctx.isRoomAllowed({ roomId, isDirect })) {
        return;
      }

      const label = resolveMatrixRoomLabel({
        roomId,
        roomName: roomInfo.name,
      });

      const sessionKey = ctx.resolveMatrixSystemEventSessionKey({
        roomId,
        isDirect,
      });

      enqueueSystemEvent(`Matrix message deleted in ${label}.`, {
        sessionKey,
        contextKey: `matrix:message:deleted:${roomId}:${redactedEventId}`,
      });

      ctx.logger.debug(
        `message redacted in ${roomId} by ${sender}: ${redactedEventId}`,
      );
    } catch (err) {
      ctx.runtime.error?.(`matrix redaction handler error: ${String(err)}`);
    }
  });
}
