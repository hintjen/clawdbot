/**
 * Matrix room configuration helpers.
 * Handles room label resolution and config lookup.
 */

import type { MatrixRoomConfig } from "../../config/types.matrix.js";

/**
 * Resolved room configuration with defaults applied.
 */
export type MatrixRoomConfigResolved = {
  allowed: boolean;
  requireMention: boolean;
  users?: string[];
  skills?: string[];
  systemPrompt?: string;
};

/**
 * Get first defined value from a list of candidates.
 */
function firstDefined<T>(...values: Array<T | undefined>): T | undefined {
  for (const value of values) {
    if (typeof value !== "undefined") return value;
  }
  return undefined;
}

/**
 * Resolve a human-readable label for a Matrix room.
 * Uses room name if available, falls back to room ID.
 */
export function resolveMatrixRoomLabel(params: {
  roomId?: string;
  roomName?: string;
}): string {
  const roomName = params.roomName?.trim();
  if (roomName) {
    return roomName;
  }
  const roomId = params.roomId?.trim();
  return roomId || "unknown room";
}

/**
 * Normalize a room ID or alias for config lookup.
 * Matrix room IDs are case-sensitive, but we lowercase aliases for matching.
 */
function normalizeMatrixRoomKey(key: string): string {
  const trimmed = key.trim();
  // Room aliases start with #, room IDs start with !
  if (trimmed.startsWith("#")) {
    return trimmed.toLowerCase();
  }
  // Room IDs are case-sensitive, don't lowercase
  return trimmed;
}

/**
 * Resolve room configuration from config.
 *
 * Lookup order:
 * 1. Exact room ID match
 * 2. Room alias match (normalized)
 * 3. Wildcard "*" fallback
 *
 * @returns Resolved config or null if room not in config
 */
export function resolveMatrixRoomConfig(params: {
  roomId: string;
  roomAlias?: string;
  rooms?: Record<string, MatrixRoomConfig | undefined>;
}): MatrixRoomConfigResolved | null {
  const { roomId, roomAlias, rooms } = params;
  const entries = rooms ?? {};
  const keys = Object.keys(entries);

  // Build candidate keys for lookup
  const candidates = [
    roomId,
    roomAlias,
    roomAlias ? normalizeMatrixRoomKey(roomAlias) : undefined,
  ].filter((k): k is string => Boolean(k));

  // Find first matching entry
  let matched: MatrixRoomConfig | undefined;
  for (const candidate of candidates) {
    const entry = entries[candidate];
    if (entry) {
      matched = entry;
      break;
    }
  }

  // Check wildcard fallback
  const fallback = entries["*"];

  // If no rooms configured, default allow with requireMention
  if (keys.length === 0) {
    return { allowed: true, requireMention: true };
  }

  // If no match and no fallback, room is not allowed
  if (!matched && !fallback) {
    return { allowed: false, requireMention: true };
  }

  const resolved = matched ?? fallback ?? {};

  const allowed =
    firstDefined(
      resolved.enabled,
      resolved.allow,
      fallback?.enabled,
      fallback?.allow,
      true,
    ) ?? true;

  const requireMention =
    firstDefined(resolved.requireMention, fallback?.requireMention, true) ??
    true;

  const users = firstDefined(resolved.users, fallback?.users);
  const skills = firstDefined(resolved.skills, fallback?.skills);
  const systemPrompt = firstDefined(
    resolved.systemPrompt,
    fallback?.systemPrompt,
  );

  return { allowed, requireMention, users, skills, systemPrompt };
}
