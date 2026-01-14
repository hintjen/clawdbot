import type { ClawdbotConfig } from "../../config/config.js";
import type { RuntimeEnv } from "../../runtime.js";
import type { MatrixFile, MatrixMessageEvent } from "../types.js";

/**
 * Options for monitorMatrixProvider()
 */
export type MonitorMatrixOpts = {
  /** Override access token (instead of config/env). */
  accessToken?: string;
  /** Override password (instead of config/env). */
  password?: string;
  /** Account ID to monitor (for multi-account). */
  accountId?: string;
  /** Full Clawdbot config (auto-resolved if not provided). */
  config?: ClawdbotConfig;
  /** Runtime env for logging/exit. */
  runtime?: RuntimeEnv;
  /** Abort signal for graceful shutdown. */
  abortSignal?: AbortSignal;
  /** Max media size in MB. */
  mediaMaxMb?: number;
};

/**
 * Matrix reaction event (m.reaction)
 */
export type MatrixReactionEvent = {
  type: "m.reaction";
  eventId: string;
  roomId: string;
  sender: string;
  /** Event ID being reacted to. */
  targetEventId: string;
  /** Reaction key (emoji). */
  key: string;
  timestamp: number;
};

/**
 * Matrix member event (m.room.member)
 */
export type MatrixMemberEvent = {
  type: "m.room.member";
  eventId: string;
  roomId: string;
  sender: string;
  /** Target user of the membership change. */
  userId: string;
  /** Membership state (join, leave, invite, ban, knock). */
  membership: "join" | "leave" | "invite" | "ban" | "knock";
  /** Previous membership state. */
  prevMembership?: "join" | "leave" | "invite" | "ban" | "knock";
  /** Display name if available. */
  displayName?: string;
  /** Avatar URL if available. */
  avatarUrl?: string;
  timestamp: number;
};

/**
 * Matrix room event (invites, upgrades, etc.)
 */
export type MatrixRoomEvent = {
  type: "invite" | "tombstone" | "create";
  eventId: string;
  roomId: string;
  sender: string;
  /** For tombstone: replacement room ID. */
  replacementRoom?: string;
  /** For invite: invited user ID. */
  invitedUser?: string;
  timestamp: number;
};

/**
 * Matrix typing event (m.typing)
 */
export type MatrixTypingEvent = {
  roomId: string;
  /** User IDs currently typing. */
  userIds: string[];
};

/**
 * Matrix redaction event (m.room.redaction)
 */
export type MatrixRedactionEvent = {
  type: "m.room.redaction";
  eventId: string;
  roomId: string;
  sender: string;
  /** Event ID being redacted. */
  redactedEventId: string;
  /** Optional reason for redaction. */
  reason?: string;
  timestamp: number;
};

// Re-export types from main types.ts for convenience
export type { MatrixFile, MatrixMessageEvent };
