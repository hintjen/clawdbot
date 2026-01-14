/**
 * Matrix monitor provider entry point.
 * Main entry point for monitoring a Matrix account.
 *
 * Pattern follows Slack/Discord providers:
 * 1. Load config via resolveMatrixAccount()
 * 2. Create Matrix client
 * 3. Login (accessToken or password)
 * 4. Create monitor context
 * 5. Register event handlers
 * 6. Start sync loop
 * 7. Return cleanup handle
 */

import { resolveTextChunkLimit } from "../../auto-reply/chunk.js";
import { DEFAULT_GROUP_HISTORY_LIMIT } from "../../auto-reply/reply/history.js";
import { loadConfig } from "../../config/config.js";
import type { SessionScope } from "../../config/sessions.js";
import type { DmPolicy, GroupPolicy } from "../../config/types.js";
import type { MatrixReactionNotificationMode } from "../../config/types.matrix.js";
import { danger, logVerbose, shouldLogVerbose } from "../../globals.js";
import { normalizeMainKey } from "../../routing/session-key.js";
import type { RuntimeEnv } from "../../runtime.js";
import { resolveMatrixAccount } from "../accounts.js";
import {
  createMatrixClient,
  loginMatrix,
  startMatrixSync,
  waitForMatrixClientStop,
} from "../client.js";
import { createMatrixMonitorContext } from "./context.js";
import { registerMatrixEvents } from "./events/index.js";
import { createMatrixMessageHandler } from "./message-handler/index.js";
import type { MonitorMatrixOpts } from "./types.js";

/**
 * Summarize an allowlist for verbose logging.
 */
function summarizeAllowList(list?: string[]): string {
  if (!list || list.length === 0) return "any";
  const sample = list.slice(0, 4);
  const suffix =
    list.length > sample.length ? ` (+${list.length - sample.length})` : "";
  return `${sample.join(", ")}${suffix}`;
}

/**
 * Summarize room config for verbose logging.
 */
function summarizeRooms(
  rooms?: Record<string, unknown>,
): string {
  if (!rooms || Object.keys(rooms).length === 0) return "any";
  const keys = Object.keys(rooms);
  const sample = keys.slice(0, 4);
  const suffix =
    keys.length > sample.length ? ` (+${keys.length - sample.length})` : "";
  return `${sample.join(", ")}${suffix}`;
}

/**
 * Monitor a Matrix account for incoming messages and events.
 *
 * This is the main entry point for the Matrix provider. It:
 * - Resolves account configuration
 * - Creates and logs into the Matrix client
 * - Sets up event handlers
 * - Starts the sync loop
 * - Waits for abort signal or fatal error
 */
export async function monitorMatrixProvider(
  opts: MonitorMatrixOpts = {},
): Promise<void> {
  const cfg = opts.config ?? loadConfig();

  const account = resolveMatrixAccount({
    cfg,
    accountId: opts.accountId,
  });

  if (!account.enabled) {
    throw new Error(
      `Matrix account "${account.accountId}" is disabled.`,
    );
  }

  if (!account.homeserver) {
    throw new Error(
      `Matrix homeserver URL missing for account "${account.accountId}" (set channels.matrix.homeserver or channels.matrix.accounts.${account.accountId}.homeserver).`,
    );
  }

  if (!account.userId) {
    throw new Error(
      `Matrix userId missing for account "${account.accountId}" (set channels.matrix.userId or channels.matrix.accounts.${account.accountId}.userId).`,
    );
  }

  // Resolve credentials (opts override config)
  const accessToken = opts.accessToken ?? account.accessToken;
  const password = opts.password ?? account.password;

  if (!accessToken && !password) {
    throw new Error(
      `Matrix credentials missing for account "${account.accountId}" (set accessToken or password in config, or MATRIX_ACCESS_TOKEN/MATRIX_PASSWORD env vars for default account).`,
    );
  }

  const runtime: RuntimeEnv = opts.runtime ?? {
    log: console.log,
    error: console.error,
    exit: (code: number): never => {
      throw new Error(`exit ${code}`);
    },
  };

  const matrixCfg = account.config;
  const dmConfig = matrixCfg.dm;
  const roomsConfig = matrixCfg.rooms;
  const groupPolicy = (matrixCfg.groupPolicy ?? "open") as GroupPolicy;
  const allowFrom = dmConfig?.allowFrom;
  const mediaMaxBytes =
    (opts.mediaMaxMb ?? matrixCfg.mediaMaxMb ?? 10) * 1024 * 1024;
  const textLimit = resolveTextChunkLimit(cfg, "matrix", account.accountId);
  const historyLimit = Math.max(
    0,
    matrixCfg.historyLimit ??
      cfg.messages?.groupChat?.historyLimit ??
      DEFAULT_GROUP_HISTORY_LIMIT,
  );
  const replyToMode = matrixCfg.replyToMode ?? "off";
  const dmEnabled = dmConfig?.enabled ?? true;
  const dmPolicy = (dmConfig?.policy ?? "pairing") as DmPolicy;
  const reactionMode: MatrixReactionNotificationMode =
    matrixCfg.reactionNotifications ?? "own";
  const reactionAllowlist = matrixCfg.reactionAllowlist ?? [];

  const sessionCfg = cfg.session;
  const sessionScope: SessionScope = sessionCfg?.scope ?? "per-sender";
  const mainKey = normalizeMainKey(sessionCfg?.mainKey);

  if (shouldLogVerbose()) {
    logVerbose(
      `matrix: config dm=${dmEnabled ? "on" : "off"} dmPolicy=${dmPolicy} allowFrom=${summarizeAllowList(allowFrom)} groupPolicy=${groupPolicy} rooms=${summarizeRooms(roomsConfig)} historyLimit=${historyLimit} mediaMaxMb=${Math.round(mediaMaxBytes / (1024 * 1024))} reactionMode=${reactionMode} replyToMode=${replyToMode}`,
    );
  }

  // Create Matrix client
  const client = createMatrixClient({
    homeserver: account.homeserver,
    userId: account.userId,
    accessToken,
    deviceId: account.deviceId,
  });

  // Login (token or password)
  let botUserId: string;
  try {
    const loginResult = await loginMatrix(client, {
      userId: account.userId,
      accessToken,
      password,
      deviceId: account.deviceId,
    });
    botUserId = loginResult.userId;
  } catch (err) {
    runtime.error?.(danger(`matrix login failed: ${String(err)}`));
    throw err;
  }

  runtime.log?.(
    `logged in to matrix as ${botUserId} on ${account.homeserver}`,
  );

  // Create monitor context
  const ctx = createMatrixMonitorContext({
    cfg,
    accountId: account.accountId,
    client,
    runtime,
    botUserId,
    homeserver: account.homeserver,
    historyLimit,
    sessionScope,
    mainKey,
    dmEnabled,
    dmPolicy,
    allowFrom,
    roomsConfig,
    groupPolicy,
    reactionMode,
    reactionAllowlist,
    replyToMode,
    textLimit,
    mediaMaxBytes,
  });

  // Create message handler
  const handleMatrixMessage = createMatrixMessageHandler({ ctx });

  // Register event handlers
  registerMatrixEvents({ ctx, handleMatrixMessage });

  // Start sync loop
  try {
    await startMatrixSync(client, { runtime });
    runtime.log?.("matrix sync started");
  } catch (err) {
    runtime.error?.(danger(`matrix sync failed to start: ${String(err)}`));
    throw err;
  }

  // Wait for shutdown signal or fatal error
  await waitForMatrixClientStop({
    client,
    abortSignal: opts.abortSignal,
    runtime,
    onSyncError: (err) => {
      runtime.error?.(danger(`matrix sync error: ${String(err)}`));
    },
  });
}
