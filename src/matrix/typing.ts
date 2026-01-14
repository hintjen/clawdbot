/**
 * Matrix typing indicator functions.
 * Sends and stops typing indicators to Matrix rooms.
 */

import type { MatrixClient } from "matrix-js-sdk";

import { logVerbose } from "../globals.js";

export type SendMatrixTypingParams = {
  client: MatrixClient;
  roomId: string;
  /** Whether to start typing (default: true). */
  typing?: boolean;
  /** How long the typing indicator should last in ms (default: 30000). */
  timeoutMs?: number;
};

/**
 * Send typing indicator to a Matrix room.
 * Call when bot starts processing a message.
 */
export async function sendMatrixTyping(params: SendMatrixTypingParams): Promise<void> {
  const { client, roomId, typing = true, timeoutMs = 30000 } = params;
  try {
    await client.sendTyping(roomId, typing, timeoutMs);
  } catch (err) {
    logVerbose(`matrix: typing indicator failed for room ${roomId}: ${String(err)}`);
  }
}

/**
 * Stop typing indicator for a Matrix room.
 * Call after response is sent.
 */
export async function stopMatrixTyping(params: {
  client: MatrixClient;
  roomId: string;
}): Promise<void> {
  await sendMatrixTyping({ ...params, typing: false });
}
