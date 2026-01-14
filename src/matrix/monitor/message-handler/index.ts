/**
 * Matrix message handler factory.
 *
 * Creates a message handler function for processing Matrix room messages.
 * Pattern follows Discord/Slack: preflight -> process pipeline.
 */

import { danger } from "../../../globals.js";
import type { MatrixMonitorContext } from "../context.js";
import type { MatrixMessageHandler } from "../events/types.js";

/**
 * Parameters for creating a Matrix message handler.
 */
export type CreateMatrixMessageHandlerParams = {
  ctx: MatrixMonitorContext;
};

/**
 * Create a Matrix message handler.
 *
 * Returns a function that:
 * 1. Runs preflight checks (sender allowed, room allowed, mention required)
 * 2. Processes the message (builds context, dispatches to agent)
 *
 * Designed for non-blocking concurrent execution:
 * - Handler returns quickly after dispatching to agent
 * - Errors are caught and logged, not thrown
 */
export function createMatrixMessageHandler(
  params: CreateMatrixMessageHandlerParams,
): MatrixMessageHandler {
  const { ctx } = params;

  return async (message, meta) => {
    try {
      // Import preflight and process dynamically to allow circular deps
      // (process.ts will import from context which may reference handler)
      const { preflightMatrixMessage } = await import("./preflight.js");
      const { processMatrixMessage } = await import("./process.js");

      // Run preflight checks
      const prepared = await preflightMatrixMessage({
        ctx,
        message,
        meta,
      });

      // If preflight returns null, message should be skipped
      if (!prepared) return;

      // Process the message (dispatch to agent)
      await processMatrixMessage(prepared);
    } catch (err) {
      ctx.runtime.error?.(
        danger(`matrix message handler failed: ${String(err)}`),
      );
    }
  };
}
