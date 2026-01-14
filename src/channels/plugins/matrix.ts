/**
 * Matrix channel plugin for Clawdbot.
 * Integrates Matrix (Element, etc.) with the channel docking system.
 */

import type { ClawdbotConfig } from "../../config/config.js";
import {
  listMatrixAccountIds,
  type ResolvedMatrixAccount,
  resolveDefaultMatrixAccountId,
  resolveMatrixAccount,
} from "../../matrix/accounts.js";
import { probeMatrix } from "../../matrix/probe.js";
import { sendMessageMatrix } from "../../matrix/send.js";
import { shouldLogVerbose } from "../../globals.js";
import {
  DEFAULT_ACCOUNT_ID,
  normalizeAccountId,
} from "../../routing/session-key.js";
import { getChatChannelMeta } from "../registry.js";
import {
  deleteAccountFromConfigSection,
  setAccountEnabledInConfigSection,
} from "./config-helpers.js";
import { formatPairingApproveHint } from "./helpers.js";
import { normalizeMatrixMessagingTarget } from "./normalize-target.js";
import { matrixOnboardingAdapter } from "./onboarding/matrix.js";
import {
  applyAccountNameToChannelSection,
  migrateBaseNameToDefaultAccount,
} from "./setup-helpers.js";
import type { ChannelGroupContext } from "./types.core.js";
import type { ChannelPlugin } from "./types.js";

const meta = getChatChannelMeta("matrix");

/**
 * Resolve require mention setting for a Matrix room.
 */
function resolveMatrixGroupRequireMention(params: ChannelGroupContext): boolean {
  const { cfg, groupId } = params;
  if (!groupId) return true;

  const rooms = cfg.channels?.matrix?.rooms;
  if (!rooms) return true;

  // Check exact room ID match
  const roomConfig = rooms[groupId];
  if (roomConfig && typeof roomConfig.requireMention === "boolean") {
    return roomConfig.requireMention;
  }

  // Check wildcard fallback
  const wildcard = rooms["*"];
  if (wildcard && typeof wildcard.requireMention === "boolean") {
    return wildcard.requireMention;
  }

  // Default: require mention in group rooms
  return true;
}

export const matrixPlugin: ChannelPlugin<ResolvedMatrixAccount> = {
  id: "matrix",
  meta: {
    ...meta,
  },
  pairing: {
    idLabel: "matrixUserId",
    normalizeAllowEntry: (entry) => entry.replace(/^(matrix|user):/i, ""),
    notifyApproval: async ({ id }) => {
      // Matrix doesn't support direct user messaging without a room,
      // so we can't notify approval directly. Users must be in a room with the bot.
      // This is a no-op for now.
      void id;
    },
  },
  capabilities: {
    chatTypes: ["direct", "channel"],
    reactions: true,
    threads: false, // Matrix has threading but different from Discord/Slack
    media: true,
  },
  streaming: {
    blockStreamingCoalesceDefaults: { minChars: 1500, idleMs: 1000 },
  },
  reload: { configPrefixes: ["channels.matrix"] },
  onboarding: matrixOnboardingAdapter,
  config: {
    listAccountIds: (cfg) => listMatrixAccountIds(cfg),
    resolveAccount: (cfg, accountId) =>
      resolveMatrixAccount({ cfg, accountId }),
    defaultAccountId: (cfg) => resolveDefaultMatrixAccountId(cfg),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg,
        sectionKey: "matrix",
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({
        cfg,
        sectionKey: "matrix",
        accountId,
        clearBaseFields: ["accessToken", "password", "homeserver", "userId", "name"],
      }),
    isConfigured: (account) =>
      Boolean(
        account.homeserver?.trim() &&
        account.userId?.trim() &&
        (account.accessToken?.trim() || account.password?.trim())
      ),
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: Boolean(
        account.homeserver?.trim() &&
        account.userId?.trim() &&
        (account.accessToken?.trim() || account.password?.trim())
      ),
      tokenSource: account.accessTokenSource,
    }),
    resolveAllowFrom: ({ cfg, accountId }) =>
      (
        resolveMatrixAccount({ cfg, accountId }).config.dm?.allowFrom ?? []
      ).map((entry) => String(entry)),
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => entry.toLowerCase()),
  },
  security: {
    resolveDmPolicy: ({ cfg, accountId, account }) => {
      const resolvedAccountId =
        accountId ?? account.accountId ?? DEFAULT_ACCOUNT_ID;
      const useAccountPath = Boolean(
        cfg.channels?.matrix?.accounts?.[resolvedAccountId],
      );
      const allowFromPath = useAccountPath
        ? `channels.matrix.accounts.${resolvedAccountId}.dm.`
        : "channels.matrix.dm.";
      return {
        policy: account.config.dm?.policy ?? "pairing",
        allowFrom: account.config.dm?.allowFrom ?? [],
        allowFromPath,
        approveHint: formatPairingApproveHint("matrix"),
        normalizeEntry: (raw) =>
          raw.replace(/^(matrix|user):/i, ""),
      };
    },
    collectWarnings: ({ account }) => {
      const groupPolicy = account.config.groupPolicy ?? "open";
      if (groupPolicy !== "open") return [];
      const roomAllowlistConfigured =
        Boolean(account.config.rooms) &&
        Object.keys(account.config.rooms ?? {}).length > 0;
      if (roomAllowlistConfigured) {
        return [
          `- Matrix rooms: groupPolicy="open" allows any room not explicitly denied to trigger (mention-gated). Set channels.matrix.groupPolicy="allowlist" and configure channels.matrix.rooms.`,
        ];
      }
      return [
        `- Matrix rooms: groupPolicy="open" with no room allowlist; any room can trigger (mention-gated). Set channels.matrix.groupPolicy="allowlist" and configure channels.matrix.rooms.`,
      ];
    },
  },
  groups: {
    resolveRequireMention: resolveMatrixGroupRequireMention,
  },
  mentions: {
    // Matrix mentions look like @user:server.org
    stripPatterns: () => ["@[a-zA-Z0-9._=-]+:[a-zA-Z0-9._-]+"],
  },
  threading: {
    resolveReplyToMode: ({ cfg }) =>
      cfg.channels?.matrix?.replyToMode ?? "off",
  },
  messaging: {
    normalizeTarget: normalizeMatrixMessagingTarget,
  },
  setup: {
    resolveAccountId: ({ accountId }) => normalizeAccountId(accountId),
    applyAccountName: ({ cfg, accountId, name }) =>
      applyAccountNameToChannelSection({
        cfg,
        channelKey: "matrix",
        accountId,
        name,
      }),
    validateInput: ({ accountId, input }) => {
      if (input.useEnv && accountId !== DEFAULT_ACCOUNT_ID) {
        return "Matrix env credentials can only be used for the default account.";
      }
      // For Matrix, we need either accessToken or password, plus homeserver and userId
      // These are typically set in config, not via CLI setup
      return null;
    },
    applyAccountConfig: ({ cfg, accountId, input }) => {
      const namedConfig = applyAccountNameToChannelSection({
        cfg,
        channelKey: "matrix",
        accountId,
        name: input.name,
      });
      const next =
        accountId !== DEFAULT_ACCOUNT_ID
          ? migrateBaseNameToDefaultAccount({
              cfg: namedConfig,
              channelKey: "matrix",
            })
          : namedConfig;
      if (accountId === DEFAULT_ACCOUNT_ID) {
        return {
          ...next,
          channels: {
            ...next.channels,
            matrix: {
              ...next.channels?.matrix,
              enabled: true,
              // Token is typically set via config or env, not CLI
            },
          },
        } as ClawdbotConfig;
      }
      return {
        ...next,
        channels: {
          ...next.channels,
          matrix: {
            ...next.channels?.matrix,
            enabled: true,
            accounts: {
              ...next.channels?.matrix?.accounts,
              [accountId]: {
                ...next.channels?.matrix?.accounts?.[accountId],
                enabled: true,
              },
            },
          },
        },
      } as ClawdbotConfig;
    },
  },
  outbound: {
    deliveryMode: "direct",
    chunker: null,
    textChunkLimit: 4000,
    resolveTarget: ({ to }) => {
      const trimmed = to?.trim();
      if (!trimmed) {
        return {
          ok: false,
          error: new Error(
            "Delivering to Matrix requires --to <roomId|#roomAlias|room:ID>",
          ),
        };
      }
      return { ok: true, to: trimmed };
    },
    sendText: async ({ to, text, accountId, replyToId }) => {
      const result = await sendMessageMatrix(to, text, {
        replyTo: replyToId ?? undefined,
        accountId: accountId ?? undefined,
      });
      return { channel: "matrix", messageId: result.eventId, meta: { roomId: result.roomId } };
    },
    sendMedia: async ({ to, text, mediaUrl, accountId, replyToId }) => {
      const result = await sendMessageMatrix(to, text, {
        mediaUrl,
        replyTo: replyToId ?? undefined,
        accountId: accountId ?? undefined,
      });
      return { channel: "matrix", messageId: result.eventId, meta: { roomId: result.roomId } };
    },
  },
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    collectStatusIssues: (accounts) =>
      accounts.flatMap((account) => {
        const issues: Array<{
          channel: "matrix";
          accountId: string;
          kind: "runtime" | "config";
          message: string;
          fix?: string;
        }> = [];
        const accountId =
          typeof account.accountId === "string"
            ? account.accountId
            : DEFAULT_ACCOUNT_ID;

        // Check for runtime errors
        const lastError =
          typeof account.lastError === "string" ? account.lastError.trim() : "";
        if (lastError) {
          issues.push({
            channel: "matrix",
            accountId,
            kind: "runtime",
            message: `Channel error: ${lastError}`,
            fix: "Check homeserver connectivity, credentials, and Matrix server status.",
          });
        }

        // Check for probe failures
        const probe = account.probe as
          | { ok?: boolean; error?: string }
          | undefined;
        if (probe && probe.ok === false && probe.error) {
          issues.push({
            channel: "matrix",
            accountId,
            kind: "runtime",
            message: `Probe failed: ${probe.error}`,
            fix: "Verify homeserver URL, access token, and network connectivity.",
          });
        }

        return issues;
      }),
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      tokenSource: snapshot.tokenSource ?? "none",
      running: snapshot.running ?? false,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
      probe: snapshot.probe,
      lastProbeAt: snapshot.lastProbeAt ?? null,
    }),
    probeAccount: async ({ account, timeoutMs }) => {
      if (!account.homeserver?.trim()) {
        return { ok: false, error: "missing homeserver" };
      }
      if (!account.accessToken?.trim() && !account.password?.trim()) {
        return { ok: false, error: "missing credentials" };
      }
      return await probeMatrix({
        homeserver: account.homeserver,
        accessToken: account.accessToken,
        userId: account.userId,
        password: account.password,
        timeoutMs,
      });
    },
    buildAccountSnapshot: ({ account, runtime, probe }) => {
      const configured = Boolean(
        account.homeserver?.trim() &&
        account.userId?.trim() &&
        (account.accessToken?.trim() || account.password?.trim())
      );
      return {
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured,
        tokenSource: account.accessTokenSource,
        running: runtime?.running ?? false,
        lastStartAt: runtime?.lastStartAt ?? null,
        lastStopAt: runtime?.lastStopAt ?? null,
        lastError: runtime?.lastError ?? null,
        probe,
        lastInboundAt: runtime?.lastInboundAt ?? null,
        lastOutboundAt: runtime?.lastOutboundAt ?? null,
      };
    },
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      let matrixUserLabel = "";
      try {
        const probe = await probeMatrix({
          homeserver: account.homeserver,
          accessToken: account.accessToken,
          userId: account.userId,
          password: account.password,
          timeoutMs: 2500,
        });
        const displayName = probe.ok ? probe.user?.displayName?.trim() : null;
        const userId = probe.ok ? probe.user?.id?.trim() : null;
        if (displayName) {
          matrixUserLabel = ` (${displayName})`;
        } else if (userId) {
          matrixUserLabel = ` (${userId})`;
        }
        ctx.setStatus({
          accountId: account.accountId,
          probe,
        });
      } catch (err) {
        if (shouldLogVerbose()) {
          ctx.log?.debug?.(
            `[${account.accountId}] matrix probe failed: ${String(err)}`,
          );
        }
      }
      ctx.log?.info(
        `[${account.accountId}] starting provider${matrixUserLabel}`,
      );
      // Lazy import: the monitor pulls the reply pipeline; avoid ESM init cycles.
      const { monitorMatrixProvider } = await import("../../matrix/index.js");
      return monitorMatrixProvider({
        accessToken: account.accessToken,
        password: account.password,
        accountId: account.accountId,
        config: ctx.cfg,
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
        mediaMaxMb: account.config.mediaMaxMb,
      });
    },
  },
};
