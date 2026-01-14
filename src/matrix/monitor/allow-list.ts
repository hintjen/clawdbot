/**
 * Matrix AllowFrom filtering logic.
 *
 * Provides functions for:
 * - Normalizing Matrix user ID allowlists
 * - Checking if users are allowed (DM policy)
 * - Checking if rooms are allowed (room policy)
 * - Resolving per-room configuration
 * - Determining mention requirements
 */

import type { DmPolicy, GroupPolicy } from "../../config/types.base.js";
import type {
  MatrixAccountConfig,
  MatrixReactionNotificationMode,
  MatrixRoomConfig,
} from "../../config/types.matrix.js";

/**
 * Normalized Matrix allowlist for efficient lookups.
 */
export type MatrixAllowList = {
  /** True if wildcard "*" was present (allow all). */
  allowAll: boolean;
  /** Set of normalized user IDs (@user:server). */
  userIds: Set<string>;
  /** Set of server domains for wildcard domain matching (e.g., "matrix.org"). */
  domains: Set<string>;
};

/**
 * Resolved room configuration for a specific room.
 */
export type MatrixRoomConfigResolved = {
  /** Whether the room is allowed based on config. */
  allowed: boolean;
  /** Whether mentions are required in this room. */
  requireMention?: boolean;
  /** Allowlisted users for this room. */
  users?: string[];
  /** Skills loaded for this room. */
  skills?: string[];
  /** Whether the room is enabled. */
  enabled?: boolean;
  /** System prompt for this room. */
  systemPrompt?: string;
};

/**
 * Normalize a Matrix user ID for comparison.
 * Matrix user IDs are case-sensitive for the localpart but the server is case-insensitive.
 * We lowercase the entire ID for consistent matching.
 */
export function normalizeMatrixUserId(userId: string): string {
  return userId.trim().toLowerCase();
}

/**
 * Normalize a Matrix allowlist.
 *
 * Supports:
 * - Exact user IDs (@user:server)
 * - Wildcards ("*" for all)
 * - Domain wildcards ("*:matrix.org" for all users on a domain)
 *
 * @param raw - Raw allowlist from config
 * @returns Normalized allowlist for efficient lookups
 */
export function normalizeMatrixAllowList(
  raw: string[] | undefined,
): MatrixAllowList {
  const result: MatrixAllowList = {
    allowAll: false,
    userIds: new Set(),
    domains: new Set(),
  };

  if (!raw || !Array.isArray(raw) || raw.length === 0) {
    return result;
  }

  for (const entry of raw) {
    const text = String(entry).trim();
    if (!text) continue;

    // Check for universal wildcard
    if (text === "*") {
      result.allowAll = true;
      continue;
    }

    // Check for domain wildcard (*:server.org)
    if (text.startsWith("*:")) {
      const domain = text.slice(2).toLowerCase();
      if (domain) {
        result.domains.add(domain);
      }
      continue;
    }

    // Regular user ID - normalize and add
    const normalized = normalizeMatrixUserId(text);
    if (normalized) {
      result.userIds.add(normalized);
    }
  }

  return result;
}

/**
 * Check if a Matrix user ID matches an allowlist.
 *
 * @param userId - User ID to check (e.g., @alice:matrix.org)
 * @param allowList - Normalized allowlist
 * @returns True if the user matches
 */
export function allowListMatchesUser(
  userId: string,
  allowList: MatrixAllowList,
): boolean {
  if (allowList.allowAll) return true;

  const normalized = normalizeMatrixUserId(userId);

  // Check exact user ID match
  if (allowList.userIds.has(normalized)) return true;

  // Check domain wildcard match
  const colonIndex = normalized.indexOf(":");
  if (colonIndex > 0 && allowList.domains.size > 0) {
    const domain = normalized.slice(colonIndex + 1);
    if (allowList.domains.has(domain)) return true;
  }

  return false;
}

/**
 * Check if a Matrix user is allowed based on DM policy and allowlist.
 *
 * @param params - User ID and allowlist config
 * @returns True if user is allowed for DMs
 */
export function isMatrixUserAllowed(params: {
  userId: string;
  allowFrom?: string[];
  dmPolicy: DmPolicy;
}): boolean {
  const { userId, allowFrom, dmPolicy } = params;

  // "open" policy allows all users
  if (dmPolicy === "open") return true;

  // "disabled" policy blocks all DMs
  if (dmPolicy === "disabled") return false;

  // "pairing" policy requires explicit allowlist (or pending pairing request)
  // For pure allowlist check, we need to verify against the list
  if (!allowFrom || allowFrom.length === 0) {
    // No allowlist configured - pairing policy typically means wait for pairing
    return false;
  }

  const allowList = normalizeMatrixAllowList(allowFrom);
  return allowListMatchesUser(userId, allowList);
}

/**
 * Check if a Matrix room is allowed based on room config and group policy.
 *
 * @param params - Room ID and config
 * @returns True if room is allowed
 */
export function isMatrixRoomAllowed(params: {
  roomId: string;
  roomAlias?: string;
  roomName?: string;
  roomsConfig?: Record<string, MatrixRoomConfig | undefined>;
  groupPolicy: GroupPolicy;
}): boolean {
  const { roomId, roomAlias, roomName, roomsConfig, groupPolicy } = params;

  // "disabled" policy blocks all rooms
  if (groupPolicy === "disabled") return false;

  // "open" policy allows all rooms (subject to mention requirements)
  if (groupPolicy === "open") return true;

  // "allowlist" policy - must find room in config
  if (groupPolicy === "allowlist") {
    const resolved = resolveMatrixRoomConfig({
      roomId,
      roomAlias,
      roomName,
      roomsConfig,
    });

    return resolved !== null && resolved.allowed;
  }

  return false;
}

/**
 * Resolve the room configuration for a specific room.
 *
 * Looks up by:
 * 1. Room ID (!roomid:server)
 * 2. Room alias (#alias:server)
 * 3. Room name
 * 4. Wildcard "*"
 *
 * @param params - Room identifiers and config
 * @returns Resolved room config or null if not found
 */
export function resolveMatrixRoomConfig(params: {
  roomId: string;
  roomAlias?: string;
  roomName?: string;
  roomsConfig?: Record<string, MatrixRoomConfig | undefined>;
}): MatrixRoomConfigResolved | null {
  const { roomId, roomAlias, roomName, roomsConfig } = params;

  if (!roomsConfig) return null;

  // Try room ID first (exact match)
  const byId = roomsConfig[roomId];
  if (byId) {
    return {
      allowed: byId.enabled !== false && byId.allow !== false,
      requireMention: byId.requireMention,
      users: byId.users,
      skills: byId.skills,
      enabled: byId.enabled,
      systemPrompt: byId.systemPrompt,
    };
  }

  // Try room alias
  if (roomAlias) {
    const byAlias = roomsConfig[roomAlias];
    if (byAlias) {
      return {
        allowed: byAlias.enabled !== false && byAlias.allow !== false,
        requireMention: byAlias.requireMention,
        users: byAlias.users,
        skills: byAlias.skills,
        enabled: byAlias.enabled,
        systemPrompt: byAlias.systemPrompt,
      };
    }

    // Try alias without leading #
    const aliasWithoutHash = roomAlias.startsWith("#")
      ? roomAlias.slice(1)
      : undefined;
    if (aliasWithoutHash) {
      const byStrippedAlias = roomsConfig[aliasWithoutHash];
      if (byStrippedAlias) {
        return {
          allowed:
            byStrippedAlias.enabled !== false &&
            byStrippedAlias.allow !== false,
          requireMention: byStrippedAlias.requireMention,
          users: byStrippedAlias.users,
          skills: byStrippedAlias.skills,
          enabled: byStrippedAlias.enabled,
          systemPrompt: byStrippedAlias.systemPrompt,
        };
      }
    }
  }

  // Try room name
  if (roomName) {
    const byName = roomsConfig[roomName];
    if (byName) {
      return {
        allowed: byName.enabled !== false && byName.allow !== false,
        requireMention: byName.requireMention,
        users: byName.users,
        skills: byName.skills,
        enabled: byName.enabled,
        systemPrompt: byName.systemPrompt,
      };
    }
  }

  // Try wildcard
  const wildcard = roomsConfig["*"];
  if (wildcard) {
    return {
      allowed: wildcard.enabled !== false && wildcard.allow !== false,
      requireMention: wildcard.requireMention,
      users: wildcard.users,
      skills: wildcard.skills,
      enabled: wildcard.enabled,
      systemPrompt: wildcard.systemPrompt,
    };
  }

  return null;
}

/**
 * Determine if mentions are required for a room.
 *
 * Order of precedence:
 * 1. Room-specific config
 * 2. Account default (true for rooms)
 *
 * @param params - Room config (resolved)
 * @returns True if bot requires mention to respond
 */
export function resolveMatrixShouldRequireMention(params: {
  isDirect?: boolean;
  roomConfig?: MatrixRoomConfigResolved | null;
  accountRequireMention?: boolean;
}): boolean {
  const { isDirect, roomConfig, accountRequireMention } = params;

  // DMs never require mentions
  if (isDirect) return false;

  // Check room-specific setting
  if (roomConfig?.requireMention !== undefined) {
    return roomConfig.requireMention;
  }

  // Default: require mention in rooms
  return accountRequireMention ?? true;
}

/**
 * Check if a user is allowed to send messages in a specific room.
 *
 * @param params - User ID and room config
 * @returns True if user is allowed
 */
export function isMatrixRoomUserAllowed(params: {
  userId: string;
  roomConfig?: MatrixRoomConfigResolved | null;
}): boolean {
  const { userId, roomConfig } = params;

  // No room config = all users allowed
  if (!roomConfig) return true;

  // No per-room users list = all users allowed
  if (!roomConfig.users || roomConfig.users.length === 0) return true;

  // Check against room's user allowlist
  const allowList = normalizeMatrixAllowList(roomConfig.users);
  return allowListMatchesUser(userId, allowList);
}

/**
 * Check if reaction notifications should be emitted for a reaction.
 *
 * @param params - Reaction context
 * @returns True if notification should be emitted
 */
export function shouldEmitMatrixReactionNotification(params: {
  mode: MatrixReactionNotificationMode;
  botUserId: string;
  messageAuthorId?: string;
  reactorUserId: string;
  reactionAllowlist?: string[];
}): boolean {
  const { mode, botUserId, messageAuthorId, reactorUserId, reactionAllowlist } =
    params;

  switch (mode) {
    case "off":
      return false;

    case "all":
      return true;

    case "own":
      // Only emit if reaction is on bot's own message
      return messageAuthorId === botUserId;

    case "allowlist":
      // Check if reactor is in allowlist
      if (!reactionAllowlist || reactionAllowlist.length === 0) return false;
      const allowList = normalizeMatrixAllowList(reactionAllowlist);
      return allowListMatchesUser(reactorUserId, allowList);

    default:
      return false;
  }
}

/**
 * Check if room is allowed by group policy (internal helper).
 */
export function isMatrixRoomAllowedByPolicy(params: {
  groupPolicy: GroupPolicy;
  roomAllowlistConfigured: boolean;
  roomAllowed: boolean;
}): boolean {
  const { groupPolicy, roomAllowlistConfigured, roomAllowed } = params;

  switch (groupPolicy) {
    case "disabled":
      return false;
    case "open":
      return true;
    case "allowlist":
      return roomAllowlistConfigured && roomAllowed;
    default:
      return false;
  }
}
