/**
 * Matrix client lifecycle management.
 * Handles client creation, login, sync loop, and graceful shutdown.
 */

import type {
  MatrixClient,
  ICreateClientOpts,
  SyncState,
} from "matrix-js-sdk";
import { ClientEvent, Filter } from "matrix-js-sdk";
import * as sdk from "matrix-js-sdk";
import { logVerbose, shouldLogVerbose, danger } from "../globals.js";
import type { RuntimeEnv } from "../runtime.js";

export type CreateMatrixClientOpts = {
  homeserver: string;
  userId?: string;
  accessToken?: string;
  deviceId?: string;
  /** Store type for client state (default: memory). */
  storeType?: "memory" | "none";
};

export type LoginMatrixOpts = {
  /** Use accessToken if available (default: true). */
  useAccessToken?: boolean;
  /** User ID for password login (required if using password). */
  userId?: string;
  /** Access token for token-based login. */
  accessToken?: string;
  /** Password for password-based login. */
  password?: string;
  /** Device ID to use for the session. */
  deviceId?: string;
  /** Device display name (for new device creation). */
  deviceDisplayName?: string;
};

export type MatrixSyncState =
  | "PREPARED"
  | "SYNCING"
  | "CATCHUP"
  | "STOPPED"
  | "ERROR";

export type MatrixClientHandle = {
  client: MatrixClient;
  userId: string;
  homeserver: string;
  disconnect: () => void;
};

/**
 * Create a Matrix client instance.
 * Does not start sync or login - call loginMatrix() and startMatrixSync() after.
 */
export function createMatrixClient(opts: CreateMatrixClientOpts): MatrixClient {
  const { homeserver, userId, accessToken, deviceId, storeType = "memory" } = opts;

  if (!homeserver) {
    throw new Error("Matrix homeserver URL is required");
  }

  const clientOpts: ICreateClientOpts = {
    baseUrl: homeserver,
    userId,
    accessToken,
    deviceId,
  };

  // Configure store based on type
  if (storeType === "memory") {
    clientOpts.store = new sdk.MemoryStore();
  }
  // "none" means no store config - defaults to matrix-js-sdk internal handling

  const client = sdk.createClient(clientOpts);
  return client;
}

/**
 * Login to Matrix using access token or password.
 * If accessToken is provided, it's set directly without a login call.
 * If password is provided, performs a password login.
 */
export async function loginMatrix(
  client: MatrixClient,
  opts: LoginMatrixOpts,
): Promise<{ userId: string; deviceId: string; accessToken: string }> {
  const {
    useAccessToken = true,
    userId,
    accessToken,
    password,
    deviceId,
    deviceDisplayName = "Clawdbot",
  } = opts;

  // Token-based login (no login call needed - token is already set)
  if (useAccessToken && accessToken) {
    // Verify token by fetching whoami
    try {
      const whoami = await client.whoami();
      const resolvedUserId = whoami.user_id;
      const resolvedDeviceId = whoami.device_id ?? deviceId ?? "";

      logVerbose(`matrix: token login success as ${resolvedUserId}`);
      return {
        userId: resolvedUserId,
        deviceId: resolvedDeviceId,
        accessToken,
      };
    } catch (err) {
      throw new Error(`Matrix token authentication failed: ${String(err)}`);
    }
  }

  // Password-based login
  if (password && userId) {
    try {
      const loginResponse = await client.login("m.login.password", {
        user: userId,
        password,
        device_id: deviceId,
        initial_device_display_name: deviceDisplayName,
      });

      const resolvedUserId = loginResponse.user_id;
      const resolvedDeviceId = loginResponse.device_id ?? "";
      const resolvedToken = loginResponse.access_token;

      logVerbose(`matrix: password login success as ${resolvedUserId}`);
      return {
        userId: resolvedUserId,
        deviceId: resolvedDeviceId,
        accessToken: resolvedToken,
      };
    } catch (err) {
      throw new Error(`Matrix password authentication failed: ${String(err)}`);
    }
  }

  throw new Error(
    "Matrix login requires either accessToken or (userId + password)",
  );
}

/**
 * Start the Matrix sync loop.
 * Returns when sync reaches PREPARED state.
 */
export async function startMatrixSync(
  client: MatrixClient,
  opts?: {
    /** Timeout for initial sync in ms (default: 30000). */
    initialSyncTimeout?: number;
    /** Filter for sync (room timeline limit, etc). */
    filter?: {
      room?: {
        timeline?: { limit?: number };
        state?: { lazy_load_members?: boolean };
      };
    };
    runtime?: RuntimeEnv;
  },
): Promise<void> {
  const {
    initialSyncTimeout = 30000,
    filter = {
      room: {
        timeline: { limit: 10 },
        state: { lazy_load_members: true },
      },
    },
    runtime,
  } = opts ?? {};

  return new Promise((resolve, reject) => {
    let resolved = false;
    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error("Matrix initial sync timeout"));
      }
    }, initialSyncTimeout);

    const syncListener = (state: SyncState, prevState: SyncState | null) => {
      if (shouldLogVerbose()) {
        logVerbose(`matrix: sync state ${prevState ?? "null"} -> ${state}`);
      }

      if (state === "PREPARED" || state === "SYNCING") {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          client.removeListener(ClientEvent.Sync, syncListener);
          resolve();
        }
      } else if (state === "ERROR") {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          client.removeListener(ClientEvent.Sync, syncListener);
          reject(new Error("Matrix sync failed"));
        }
      }
    };

    client.on(ClientEvent.Sync, syncListener);

    // Start sync with filter
    client.startClient({ filter: filter as unknown as Filter });
  });
}

/**
 * Stop the Matrix client gracefully.
 */
export async function stopMatrixClient(client: MatrixClient): Promise<void> {
  try {
    client.stopClient();
    logVerbose("matrix: client stopped");
  } catch (err) {
    logVerbose(`matrix: error stopping client: ${String(err)}`);
  }
}

/**
 * Get the current sync state of a Matrix client.
 */
export function getMatrixSyncState(client: MatrixClient): MatrixSyncState | null {
  return client.getSyncState() as MatrixSyncState | null;
}

/**
 * Check if the Matrix client is syncing (connected).
 */
export function isMatrixClientSyncing(client: MatrixClient): boolean {
  const state = getMatrixSyncState(client);
  return state === "PREPARED" || state === "SYNCING" || state === "CATCHUP";
}

/**
 * Matrix gateway handle for event-driven lifecycle management.
 * Similar to Discord's DiscordGatewayHandle pattern.
 */
export type MatrixGatewayHandle = {
  client: MatrixClient;
  disconnect: () => void;
};

/**
 * Wait for Matrix client to stop or error.
 * Used for long-running monitor providers.
 */
export async function waitForMatrixClientStop(params: {
  client: MatrixClient;
  abortSignal?: AbortSignal;
  onSyncError?: (err: unknown) => void;
  runtime?: RuntimeEnv;
}): Promise<void> {
  const { client, abortSignal, onSyncError, runtime } = params;

  return new Promise<void>((resolve) => {
    let settled = false;

    const cleanup = () => {
      abortSignal?.removeEventListener("abort", onAbort);
      client.removeListener(ClientEvent.Sync, onSync);
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        client.stopClient();
      } catch {
        // ignore stop errors
      }
      resolve();
    };

    const onAbort = () => {
      finish();
    };

    const onSync = (state: SyncState) => {
      if (state === "STOPPED") {
        finish();
      } else if (state === "ERROR") {
        const err = new Error("Matrix sync error");
        onSyncError?.(err);
        runtime?.error?.(danger(`matrix sync error: ${String(err)}`));
        // Don't stop on error - let matrix-js-sdk retry
      }
    };

    if (abortSignal?.aborted) {
      finish();
      return;
    }

    abortSignal?.addEventListener("abort", onAbort, { once: true });
    client.on(ClientEvent.Sync, onSync);
  });
}
