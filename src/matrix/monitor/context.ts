import type { MatrixClient } from "matrix-js-sdk";

import type { HistoryEntry } from "../../auto-reply/reply/history.js";
import type { ClawdbotConfig } from "../../config/config.js";
import { resolveSessionKey, type SessionScope } from "../../config/sessions.js";
import type { DmPolicy, GroupPolicy } from "../../config/types.js";
import type {
  MatrixAccountConfig,
  MatrixReactionNotificationMode,
  MatrixRoomConfig,
} from "../../config/types.matrix.js";
import { logVerbose } from "../../globals.js";
import { createDedupeCache } from "../../infra/dedupe.js";
import { getChildLogger } from "../../logging.js";
import type { RuntimeEnv } from "../../runtime.js";
import type { MatrixMessageEvent } from "../types.js";

/**
 * Matrix monitor context - shared state for event handlers.
 * Designed for non-blocking concurrent event handling.
 */
export type MatrixMonitorContext = {
  /** Full Clawdbot config. */
  cfg: ClawdbotConfig;
  /** Account ID being monitored. */
  accountId: string;
  /** Matrix client instance (thread-safe for API calls). */
  client: MatrixClient;
  /** Runtime env for logging/exit. */
  runtime: RuntimeEnv;
  /** Bot's own Matrix user ID (e.g., @bot:matrix.org). */
  botUserId: string;
  /** Homeserver URL. */
  homeserver: string;

  /** Max messages to load for room history context. */
  historyLimit: number;
  /** Per-room history storage (roomId -> entries). */
  roomHistories: Map<string, HistoryEntry[]>;
  /** Session scope mode. */
  sessionScope: SessionScope;
  /** Main session key for DMs. */
  mainKey: string;

  /** Whether DMs are enabled. */
  dmEnabled: boolean;
  /** DM access policy. */
  dmPolicy: DmPolicy;
  /** Allowlist for DM senders (normalized user IDs). */
  allowFrom: string[];

  /** Per-room config keyed by room ID or alias. */
  roomsConfig?: Record<string, MatrixRoomConfig | undefined>;
  /** Group/room policy (open, disabled, allowlist). */
  groupPolicy: GroupPolicy;

  /** Reaction notification mode. */
  reactionMode: MatrixReactionNotificationMode;
  /** Allowlist of reaction keys when mode is "allowlist". */
  reactionAllowlist: string[];
  /** Reply threading mode. */
  replyToMode: "off" | "first" | "all";

  /** Outbound text chunk limit (chars). */
  textLimit: number;
  /** Max media size in bytes. */
  mediaMaxBytes: number;

  /** Child logger for Matrix monitor. */
  logger: ReturnType<typeof getChildLogger>;

  /**
   * Check if a message was already seen (dedupe).
   * Returns true if seen before (duplicate), false if new.
   */
  markMessageSeen: (roomId: string | undefined, eventId?: string) => boolean;

  /**
   * Resolve session key for Matrix system events (reactions, etc.).
   */
  resolveMatrixSystemEventSessionKey: (params: {
    roomId?: string | null;
    isDirect?: boolean;
  }) => string;

  /**
   * Check if a room is allowed based on config/policy.
   */
  isRoomAllowed: (params: {
    roomId?: string;
    roomName?: string;
    isDirect?: boolean;
  }) => boolean;

  /**
   * Resolve room info from Matrix client (cached).
   */
  resolveRoomInfo: (roomId: string) => Promise<{
    name?: string;
    topic?: string;
    isDirect?: boolean;
    memberCount?: number;
  }>;

  /**
   * Resolve user display name from Matrix client (cached).
   */
  resolveUserDisplayName: (userId: string) => Promise<{ displayName?: string }>;
};

/**
 * Parameters for creating a Matrix monitor context.
 */
export type CreateMatrixMonitorContextParams = {
  cfg: ClawdbotConfig;
  accountId: string;
  client: MatrixClient;
  runtime: RuntimeEnv;
  botUserId: string;
  homeserver: string;

  historyLimit: number;
  sessionScope: SessionScope;
  mainKey: string;

  dmEnabled: boolean;
  dmPolicy: DmPolicy;
  allowFrom: string[] | undefined;

  roomsConfig?: Record<string, MatrixRoomConfig | undefined>;
  groupPolicy: GroupPolicy;

  reactionMode: MatrixReactionNotificationMode;
  reactionAllowlist: string[];
  replyToMode: MatrixMonitorContext["replyToMode"];

  textLimit: number;
  mediaMaxBytes: number;
};

/**
 * Normalize Matrix allowlist (user IDs).
 * Ensures lowercase for case-insensitive matching.
 */
function normalizeMatrixAllowList(
  raw: string[] | undefined,
): string[] {
  if (!raw || !Array.isArray(raw)) return [];
  return raw
    .map((s) => String(s).trim().toLowerCase())
    .filter((s) => s.length > 0);
}

/**
 * Check if room is allowed by policy and config.
 */
function isMatrixRoomAllowedByPolicy(params: {
  groupPolicy: GroupPolicy;
  roomAllowlistConfigured: boolean;
  roomAllowed: boolean;
}): boolean {
  switch (params.groupPolicy) {
    case "disabled":
      return false;
    case "open":
      return true;
    case "allowlist":
      return params.roomAllowlistConfigured && params.roomAllowed;
    default:
      return false;
  }
}

/**
 * Create a Matrix monitor context with shared state for event handlers.
 *
 * Design notes:
 * - Context is immutable after creation (thread-safe)
 * - Caches are internally synchronized (Map operations are atomic)
 * - No shared mutable state between concurrent handlers
 */
export function createMatrixMonitorContext(
  params: CreateMatrixMonitorContextParams,
): MatrixMonitorContext {
  const roomHistories = new Map<string, HistoryEntry[]>();
  const logger = getChildLogger({ module: "matrix-monitor" });

  // Caches for room/user info to avoid repeated API calls
  const roomCache = new Map<
    string,
    {
      name?: string;
      topic?: string;
      isDirect?: boolean;
      memberCount?: number;
    }
  >();
  const userCache = new Map<string, { displayName?: string }>();

  // Dedupe cache for preventing duplicate event processing
  const seenMessages = createDedupeCache({ ttlMs: 60_000, maxSize: 500 });

  // Normalize allowlists
  const allowFrom = normalizeMatrixAllowList(params.allowFrom);

  /**
   * Mark message as seen; returns true if already seen (duplicate).
   */
  const markMessageSeen = (
    roomId: string | undefined,
    eventId?: string,
  ): boolean => {
    if (!roomId || !eventId) return false;
    return seenMessages.check(`${roomId}:${eventId}`);
  };

  /**
   * Resolve session key for Matrix system events.
   */
  const resolveMatrixSystemEventSessionKey = (p: {
    roomId?: string | null;
    isDirect?: boolean;
  }): string => {
    const roomId = p.roomId?.trim() ?? "";
    if (!roomId) return params.mainKey;

    const isDirect = p.isDirect ?? false;
    const from = isDirect
      ? `matrix:dm:${roomId}`
      : `matrix:room:${roomId}`;
    const chatType = isDirect ? "direct" : "room";

    return resolveSessionKey(
      params.sessionScope,
      { From: from, ChatType: chatType, Provider: "matrix" },
      params.mainKey,
    );
  };

  /**
   * Resolve room info from Matrix client (with caching).
   */
  const resolveRoomInfo = async (
    roomId: string,
  ): Promise<{
    name?: string;
    topic?: string;
    isDirect?: boolean;
    memberCount?: number;
  }> => {
    const cached = roomCache.get(roomId);
    if (cached) return cached;

    try {
      const room = params.client.getRoom(roomId);
      if (!room) return {};

      const name = room.name || undefined;
      const topicEvent = room.currentState.getStateEvents("m.room.topic", "");
      const topic = topicEvent?.getContent()?.topic as string | undefined;
      const memberCount = room.getJoinedMemberCount();
      // Heuristic: DM if exactly 2 members
      const isDirect = memberCount === 2;

      const entry = { name, topic, isDirect, memberCount };
      roomCache.set(roomId, entry);
      return entry;
    } catch (err) {
      logVerbose(`matrix room info failed for ${roomId}: ${String(err)}`);
      return {};
    }
  };

  /**
   * Resolve user display name from Matrix client (with caching).
   */
  const resolveUserDisplayName = async (
    userId: string,
  ): Promise<{ displayName?: string }> => {
    const cached = userCache.get(userId);
    if (cached) return cached;

    try {
      const profile = await params.client.getProfileInfo(userId, "displayname");
      const displayName = profile?.displayname || undefined;
      const entry = { displayName };
      userCache.set(userId, entry);
      return entry;
    } catch (err) {
      logVerbose(`matrix user profile failed for ${userId}: ${String(err)}`);
      return {};
    }
  };

  /**
   * Check if room is allowed based on config and policy.
   */
  const isRoomAllowed = (p: {
    roomId?: string;
    roomName?: string;
    isDirect?: boolean;
  }): boolean => {
    const isDirect = p.isDirect ?? false;

    // DMs check DM policy/allowlist (handled separately in preflight)
    if (isDirect && !params.dmEnabled) return false;

    // For rooms, check group policy
    if (!isDirect && p.roomId) {
      const roomConfig = params.roomsConfig?.[p.roomId];
      const roomAllowed = roomConfig?.enabled !== false && roomConfig?.allow !== false;
      const roomAllowlistConfigured =
        Boolean(params.roomsConfig) &&
        Object.keys(params.roomsConfig ?? {}).length > 0;

      if (
        !isMatrixRoomAllowedByPolicy({
          groupPolicy: params.groupPolicy,
          roomAllowlistConfigured,
          roomAllowed,
        })
      ) {
        return false;
      }

      if (!roomAllowed) return false;
    }

    return true;
  };

  return {
    cfg: params.cfg,
    accountId: params.accountId,
    client: params.client,
    runtime: params.runtime,
    botUserId: params.botUserId,
    homeserver: params.homeserver,

    historyLimit: params.historyLimit,
    roomHistories,
    sessionScope: params.sessionScope,
    mainKey: params.mainKey,

    dmEnabled: params.dmEnabled,
    dmPolicy: params.dmPolicy,
    allowFrom,

    roomsConfig: params.roomsConfig,
    groupPolicy: params.groupPolicy,

    reactionMode: params.reactionMode,
    reactionAllowlist: params.reactionAllowlist,
    replyToMode: params.replyToMode,

    textLimit: params.textLimit,
    mediaMaxBytes: params.mediaMaxBytes,

    logger,
    markMessageSeen,
    resolveMatrixSystemEventSessionKey,
    isRoomAllowed,
    resolveRoomInfo,
    resolveUserDisplayName,
  };
}
