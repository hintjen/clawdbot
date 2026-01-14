/**
 * Matrix room event handler.
 * Handles room state events (invites, upgrades/tombstones, etc.).
 *
 * Pattern follows Slack provider: separate file for room state handling
 * with logging and tombstone detection.
 */

import type { MatrixEvent } from "matrix-js-sdk";
import { RoomStateEvent } from "matrix-js-sdk";

import type { MatrixMonitorContext } from "../context.js";

/**
 * Parameters for registerMatrixRoomEvents.
 */
export type RegisterMatrixRoomEventsParams = {
  ctx: MatrixMonitorContext;
};

/**
 * Register Matrix room event handlers.
 *
 * Handles RoomStateEvent.Events for:
 * - Room tombstones (m.room.tombstone) for room upgrades
 * - Room creation events (m.room.create)
 * - Debug logging for room state changes
 *
 * Note: Room invites are handled in members.ts via RoomMemberEvent.Membership
 * since invites are membership changes with membership="invite".
 */
export function registerMatrixRoomEvents(
  params: RegisterMatrixRoomEventsParams,
): void {
  const { ctx } = params;

  ctx.client.on(RoomStateEvent.Events, (event, state) => {
    try {
      const eventType = event.getType();
      const roomId = state?.roomId;

      if (!roomId) return;

      // Handle room tombstones (room upgrades)
      if (eventType === "m.room.tombstone") {
        handleRoomTombstone({ ctx, event, roomId });
        return;
      }

      // Handle room creation (informational logging)
      if (eventType === "m.room.create") {
        handleRoomCreate({ ctx, event, roomId });
        return;
      }

      // Handle room canonical alias changes (informational logging)
      if (eventType === "m.room.canonical_alias") {
        handleRoomAliasChange({ ctx, event, roomId });
        return;
      }

      // Handle room name changes (informational logging)
      if (eventType === "m.room.name") {
        handleRoomNameChange({ ctx, event, roomId });
        return;
      }
    } catch (err) {
      ctx.runtime.error?.(`matrix room handler error: ${String(err)}`);
    }
  });

  ctx.logger.debug("matrix room events registered");
}

/**
 * Handle room tombstone event (room upgrade/replacement).
 *
 * When a room is upgraded, the old room receives a tombstone event
 * pointing to the replacement room. The bot could auto-join the
 * replacement room to maintain continuity.
 */
function handleRoomTombstone(params: {
  ctx: MatrixMonitorContext;
  event: MatrixEvent;
  roomId: string;
}): void {
  const { ctx, event, roomId } = params;

  const content = event.getContent();
  const replacementRoom = content.replacement_room as string | undefined;
  const reason = content.body as string | undefined;

  ctx.logger.info(
    `room ${roomId} tombstoned` +
      (replacementRoom ? `, replacement: ${replacementRoom}` : "") +
      (reason ? ` (${reason})` : ""),
  );

  // Future enhancement: auto-join replacement room based on config
  // if (replacementRoom && ctx.shouldAutoFollowRoomUpgrade(roomId)) {
  //   ctx.client.joinRoom(replacementRoom).catch((err) => {
  //     ctx.runtime.error?.(`failed to join replacement room: ${String(err)}`);
  //   });
  // }
}

/**
 * Handle room creation event.
 * Logs room creation for debugging purposes.
 */
function handleRoomCreate(params: {
  ctx: MatrixMonitorContext;
  event: MatrixEvent;
  roomId: string;
}): void {
  const { ctx, event, roomId } = params;

  const content = event.getContent();
  const creator = content.creator as string | undefined;
  const roomVersion = content.room_version as string | undefined;
  const predecessor = content.predecessor as
    | { room_id?: string; event_id?: string }
    | undefined;

  ctx.logger.debug(
    `room ${roomId} created` +
      (creator ? ` by ${creator}` : "") +
      (roomVersion ? ` (v${roomVersion})` : "") +
      (predecessor?.room_id ? ` [upgraded from ${predecessor.room_id}]` : ""),
  );
}

/**
 * Handle room canonical alias change.
 * Logs alias changes for debugging purposes.
 */
function handleRoomAliasChange(params: {
  ctx: MatrixMonitorContext;
  event: MatrixEvent;
  roomId: string;
}): void {
  const { ctx, event, roomId } = params;

  const content = event.getContent();
  const alias = content.alias as string | undefined;
  const altAliases = content.alt_aliases as string[] | undefined;

  ctx.logger.debug(
    `room ${roomId} alias changed` +
      (alias ? `: ${alias}` : ": (removed)") +
      (altAliases?.length ? ` [+${altAliases.length} alt]` : ""),
  );
}

/**
 * Handle room name change.
 * Logs name changes for debugging purposes.
 */
function handleRoomNameChange(params: {
  ctx: MatrixMonitorContext;
  event: MatrixEvent;
  roomId: string;
}): void {
  const { ctx, event, roomId } = params;

  const content = event.getContent();
  const name = content.name as string | undefined;

  ctx.logger.debug(`room ${roomId} name changed: ${name ?? "(removed)"}`);
}
