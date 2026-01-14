/**
 * Matrix connection probe/health check.
 * Tests Matrix homeserver connectivity and authentication.
 */

import * as sdk from "matrix-js-sdk";
import { normalizeMatrixAccessToken } from "./token.js";

export type MatrixProbe = {
  ok: boolean;
  status?: number | null;
  error?: string | null;
  elapsedMs: number;
  user?: { id?: string | null; displayName?: string | null };
  homeserver?: { url?: string | null };
  syncState?: string | null;
};

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return promise;
  let timer: NodeJS.Timeout | null = null;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export type ProbeMatrixOpts = {
  /** Matrix homeserver URL (e.g., "https://matrix.org"). */
  homeserver: string;
  /** Access token for authentication. */
  accessToken?: string;
  /** User ID for password auth (e.g., "@user:matrix.org"). */
  userId?: string;
  /** Password for authentication. */
  password?: string;
  /** Timeout in milliseconds (default: 5000). */
  timeoutMs?: number;
};

/**
 * Probe Matrix homeserver connectivity and authentication.
 * Uses the whoami endpoint to verify credentials without starting sync.
 */
export async function probeMatrix(opts: ProbeMatrixOpts): Promise<MatrixProbe> {
  const { homeserver, accessToken, userId, password, timeoutMs = 5000 } = opts;
  const start = Date.now();

  const result: MatrixProbe = {
    ok: false,
    status: null,
    error: null,
    elapsedMs: 0,
    homeserver: { url: homeserver ?? null },
  };

  // Validate homeserver
  if (!homeserver?.trim()) {
    return {
      ...result,
      error: "missing homeserver URL",
      elapsedMs: Date.now() - start,
    };
  }

  // Normalize access token
  const normalizedToken = normalizeMatrixAccessToken(accessToken);

  // Need either access token or password + userId
  if (!normalizedToken && !(password && userId)) {
    return {
      ...result,
      error: "missing credentials (accessToken or userId + password required)",
      elapsedMs: Date.now() - start,
    };
  }

  try {
    let client: sdk.MatrixClient;
    let resolvedToken = normalizedToken;

    if (normalizedToken) {
      // Token-based auth: create client with token
      client = sdk.createClient({
        baseUrl: homeserver,
        accessToken: normalizedToken,
      });
    } else if (password && userId) {
      // Password-based auth: login first to get token
      client = sdk.createClient({ baseUrl: homeserver });
      try {
        const loginResponse = await withTimeout(
          client.loginWithPassword(userId, password),
          timeoutMs,
        );
        resolvedToken = loginResponse.access_token;
        // Recreate client with the new token
        client = sdk.createClient({
          baseUrl: homeserver,
          accessToken: resolvedToken,
          userId: loginResponse.user_id,
        });
      } catch (loginErr) {
        const message =
          loginErr instanceof Error ? loginErr.message : String(loginErr);
        return {
          ...result,
          error: `login failed: ${message}`,
          elapsedMs: Date.now() - start,
        };
      }
    } else {
      return {
        ...result,
        error: "missing credentials",
        elapsedMs: Date.now() - start,
      };
    }

    // Verify credentials via whoami endpoint
    const whoami = await withTimeout(client.whoami(), timeoutMs);

    result.ok = true;
    result.user = {
      id: whoami.user_id ?? null,
      displayName: null, // Would need additional API call to get display name
    };

    // Try to get display name (optional, don't fail if this errors)
    if (whoami.user_id) {
      try {
        const profile = await withTimeout(
          client.getProfileInfo(whoami.user_id, "displayname"),
          Math.min(timeoutMs, 2000),
        );
        if (profile?.displayname) {
          result.user.displayName = profile.displayname;
        }
      } catch {
        // Ignore profile fetch errors - whoami succeeded
      }
    }

    return { ...result, elapsedMs: Date.now() - start };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Try to extract HTTP status if available
    const status =
      typeof (err as { httpStatus?: number }).httpStatus === "number"
        ? (err as { httpStatus?: number }).httpStatus
        : typeof (err as { status?: number }).status === "number"
          ? (err as { status?: number }).status
          : null;

    return {
      ...result,
      status,
      error: message,
      elapsedMs: Date.now() - start,
    };
  }
}
