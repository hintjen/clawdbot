import type {
  BlockStreamingCoalesceConfig,
  DmPolicy,
  GroupPolicy,
  ReplyToMode,
} from "./types.base.js";
import type { DmConfig, ProviderCommandsConfig } from "./types.messages.js";

export type MatrixDmConfig = {
  /** If false, ignore all incoming Matrix DMs. Default: true. */
  enabled?: boolean;
  /** Direct message access policy (default: pairing). */
  policy?: DmPolicy;
  /** Allowlist for DM senders (user IDs like @user:server.org). */
  allowFrom?: string[];
};

export type MatrixRoomConfig = {
  /** If false, disable the bot for this room. */
  enabled?: boolean;
  /** If true, allow this room (for allowlist policy). */
  allow?: boolean;
  /** If true, require mention to respond in this room. */
  requireMention?: boolean;
  /** Optional allowlist for room senders (user IDs). */
  users?: string[];
  /** If specified, only load these skills for this room. */
  skills?: string[];
  /** Optional system prompt snippet for this room. */
  systemPrompt?: string;
};

export type MatrixReactionNotificationMode =
  | "off"
  | "own"
  | "all"
  | "allowlist";

export type MatrixActionConfig = {
  reactions?: boolean;
  messages?: boolean;
  read?: boolean;
  pins?: boolean;
  memberInfo?: boolean;
  roomInfo?: boolean;
};

export type MatrixAccountConfig = {
  /** Optional display name for this account (used in CLI/UI lists). */
  name?: string;
  /** Optional provider capability tags used for agent/runtime guidance. */
  capabilities?: string[];
  /** If false, do not start this Matrix account. Default: true. */
  enabled?: boolean;
  /** Override native command registration for Matrix (bool or "auto"). */
  commands?: ProviderCommandsConfig;
  /** Matrix homeserver URL (e.g., https://matrix.org). */
  homeserver: string;
  /** Matrix user ID (e.g., @bot:matrix.org). */
  userId: string;
  /** Access token for authentication. */
  accessToken?: string;
  /** Password for authentication (if not using access token). */
  password?: string;
  /** Device ID for this session. */
  deviceId?: string;
  /**
   * Controls how room messages are handled:
   * - "open": rooms bypass allowlists; mention-gating applies
   * - "disabled": block all room messages
   * - "allowlist": only allow rooms present in matrix.rooms
   */
  groupPolicy?: GroupPolicy;
  /** Max messages to load for room history context. */
  historyLimit?: number;
  /** Max DM turns to keep as history context. */
  dmHistoryLimit?: number;
  /** Per-DM config overrides keyed by user ID. */
  dms?: Record<string, DmConfig>;
  /** Outbound text chunk size (chars). Default: 4096. */
  textChunkLimit?: number;
  /** Disable block streaming for this account. */
  blockStreaming?: boolean;
  /** Merge streamed block replies before sending. */
  blockStreamingCoalesce?: BlockStreamingCoalesceConfig;
  /** Max media size in MB. */
  mediaMaxMb?: number;
  /** Control reply threading when reply tags are present (off|first|all). */
  replyToMode?: ReplyToMode;
  /** Reaction notification mode (off|own|all|allowlist). Default: own. */
  reactionNotifications?: MatrixReactionNotificationMode;
  /** Allowlist of reaction emojis to notify on (when mode is allowlist). */
  reactionAllowlist?: string[];
  /** Per-action tool gating. */
  actions?: MatrixActionConfig;
  /** DM configuration. */
  dm?: MatrixDmConfig;
  /** Per-room config keyed by room ID or alias. */
  rooms?: Record<string, MatrixRoomConfig>;
};

export type MatrixConfig = {
  /** Optional per-account Matrix configuration (multi-account). */
  accounts?: Record<string, MatrixAccountConfig>;
} & MatrixAccountConfig;
