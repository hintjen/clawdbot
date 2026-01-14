import type { ClawdbotConfig } from "../../../config/config.js";
import type { DmPolicy } from "../../../config/types.js";
import {
  DEFAULT_ACCOUNT_ID,
  normalizeAccountId,
} from "../../../routing/session-key.js";
import {
  listMatrixAccountIds,
  resolveDefaultMatrixAccountId,
  resolveMatrixAccount,
} from "../../../matrix/accounts.js";
import { formatDocsLink } from "../../../terminal/links.js";
import type { WizardPrompter } from "../../../wizard/prompts.js";
import type {
  ChannelOnboardingAdapter,
  ChannelOnboardingDmPolicy,
} from "../onboarding-types.js";
import { addWildcardAllowFrom, promptAccountId } from "./helpers.js";

const channel = "matrix" as const;

function setMatrixDmPolicy(
  cfg: ClawdbotConfig,
  dmPolicy: DmPolicy,
): ClawdbotConfig {
  const allowFrom =
    dmPolicy === "open"
      ? addWildcardAllowFrom(cfg.channels?.matrix?.dm?.allowFrom)
      : undefined;
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      matrix: {
        ...cfg.channels?.matrix,
        dm: {
          ...cfg.channels?.matrix?.dm,
          enabled: cfg.channels?.matrix?.dm?.enabled ?? true,
          policy: dmPolicy,
          ...(allowFrom ? { allowFrom } : {}),
        },
      },
    },
  } as ClawdbotConfig;
}

async function noteMatrixTokenHelp(prompter: WizardPrompter): Promise<void> {
  await prompter.note(
    [
      "Matrix requires a homeserver URL, user ID, and authentication (access token or password).",
      "",
      "Option A: Use an access token (recommended for bots)",
      "  1) Create a dedicated bot account on your Matrix homeserver",
      "  2) Log in with a Matrix client (Element, etc.) and get an access token",
      "  3) In Element: Settings -> Help & About -> Access Token (click to reveal)",
      "",
      "Option B: Use password authentication",
      "  1) Create a dedicated bot account on your Matrix homeserver",
      "  2) Use the account's username and password",
      "",
      "Tip: Set MATRIX_ACCESS_TOKEN or MATRIX_PASSWORD in your env.",
      `Docs: ${formatDocsLink("/channels/matrix", "matrix")}`,
    ].join("\n"),
    "Matrix authentication",
  );
}

const dmPolicy: ChannelOnboardingDmPolicy = {
  label: "Matrix",
  channel,
  policyKey: "channels.matrix.dm.policy",
  allowFromKey: "channels.matrix.dm.allowFrom",
  getCurrent: (cfg) => cfg.channels?.matrix?.dm?.policy ?? "pairing",
  setPolicy: (cfg, policy) => setMatrixDmPolicy(cfg, policy),
};

export const matrixOnboardingAdapter: ChannelOnboardingAdapter = {
  channel,
  getStatus: async ({ cfg }) => {
    const configured = listMatrixAccountIds(cfg).some((accountId) => {
      const account = resolveMatrixAccount({ cfg, accountId });
      return Boolean(
        account.homeserver?.trim() &&
          account.userId?.trim() &&
          (account.accessToken?.trim() || account.password?.trim()),
      );
    });
    return {
      channel,
      configured,
      statusLines: [
        `Matrix: ${configured ? "configured" : "needs credentials"}`,
      ],
      selectionHint: configured ? "configured" : "needs credentials",
      quickstartScore: configured ? 2 : 1,
    };
  },
  configure: async ({
    cfg,
    prompter,
    accountOverrides,
    shouldPromptAccountIds,
  }) => {
    const matrixOverride = accountOverrides.matrix?.trim();
    const defaultMatrixAccountId = resolveDefaultMatrixAccountId(cfg);
    let matrixAccountId = matrixOverride
      ? normalizeAccountId(matrixOverride)
      : defaultMatrixAccountId;
    if (shouldPromptAccountIds && !matrixOverride) {
      matrixAccountId = await promptAccountId({
        cfg,
        prompter,
        label: "Matrix",
        currentId: matrixAccountId,
        listAccountIds: listMatrixAccountIds,
        defaultAccountId: defaultMatrixAccountId,
      });
    }

    let next = cfg;
    const resolvedAccount = resolveMatrixAccount({
      cfg: next,
      accountId: matrixAccountId,
    });
    const accountConfigured = Boolean(
      resolvedAccount.homeserver?.trim() &&
        resolvedAccount.userId?.trim() &&
        (resolvedAccount.accessToken?.trim() ||
          resolvedAccount.password?.trim()),
    );
    const allowEnv = matrixAccountId === DEFAULT_ACCOUNT_ID;
    const canUseEnv =
      allowEnv &&
      (Boolean(process.env.MATRIX_ACCESS_TOKEN?.trim()) ||
        Boolean(process.env.MATRIX_PASSWORD?.trim()));
    const hasConfigCredentials = Boolean(
      resolvedAccount.config.accessToken || resolvedAccount.config.password,
    );

    let homeserver: string | null = null;
    let userId: string | null = null;
    let accessToken: string | null = null;
    let password: string | null = null;

    if (!accountConfigured) {
      await noteMatrixTokenHelp(prompter);
    }

    if (
      canUseEnv &&
      !resolvedAccount.config.accessToken &&
      !resolvedAccount.config.password
    ) {
      const keepEnv = await prompter.confirm({
        message:
          "MATRIX_ACCESS_TOKEN or MATRIX_PASSWORD detected. Use env vars?",
        initialValue: true,
      });
      if (keepEnv) {
        // Still need homeserver and userId from config or prompt
        homeserver =
          resolvedAccount.homeserver?.trim() ||
          String(
            await prompter.text({
              message: "Enter Matrix homeserver URL (e.g., https://matrix.org)",
              validate: (value: string) =>
                value?.trim() ? undefined : "Required",
            }),
          ).trim();
        userId =
          resolvedAccount.userId?.trim() ||
          String(
            await prompter.text({
              message: "Enter Matrix user ID (e.g., @bot:matrix.org)",
              validate: (value: string) =>
                value?.trim() ? undefined : "Required",
            }),
          ).trim();
        next = {
          ...next,
          channels: {
            ...next.channels,
            matrix: {
              ...next.channels?.matrix,
              enabled: true,
              homeserver,
              userId,
            },
          },
        } as ClawdbotConfig;
      } else {
        // User wants to enter credentials manually
        homeserver = String(
          await prompter.text({
            message: "Enter Matrix homeserver URL (e.g., https://matrix.org)",
            initialValue: resolvedAccount.homeserver || undefined,
            validate: (value: string) =>
              value?.trim() ? undefined : "Required",
          }),
        ).trim();
        userId = String(
          await prompter.text({
            message: "Enter Matrix user ID (e.g., @bot:matrix.org)",
            initialValue: resolvedAccount.userId || undefined,
            validate: (value: string) =>
              value?.trim() ? undefined : "Required",
          }),
        ).trim();
        const authMethod = (await prompter.select({
          message: "Authentication method",
          options: [
            {
              value: "token",
              label: "Access Token (recommended for bots)",
            },
            { value: "password", label: "Password" },
          ],
        })) as string;
        if (authMethod === "token") {
          accessToken = String(
            await prompter.text({
              message: "Enter Matrix access token",
              validate: (value: string) =>
                value?.trim() ? undefined : "Required",
            }),
          ).trim();
        } else {
          // Use text for password input since WizardPrompter doesn't have a password method
          password = String(
            await prompter.text({
              message: "Enter Matrix password",
              validate: (value: string) =>
                value?.trim() ? undefined : "Required",
            }),
          ).trim();
        }
      }
    } else if (hasConfigCredentials) {
      const keep = await prompter.confirm({
        message: "Matrix credentials already configured. Keep them?",
        initialValue: true,
      });
      if (!keep) {
        homeserver = String(
          await prompter.text({
            message: "Enter Matrix homeserver URL (e.g., https://matrix.org)",
            initialValue: resolvedAccount.homeserver || undefined,
            validate: (value: string) =>
              value?.trim() ? undefined : "Required",
          }),
        ).trim();
        userId = String(
          await prompter.text({
            message: "Enter Matrix user ID (e.g., @bot:matrix.org)",
            initialValue: resolvedAccount.userId || undefined,
            validate: (value: string) =>
              value?.trim() ? undefined : "Required",
          }),
        ).trim();
        const authMethod = (await prompter.select({
          message: "Authentication method",
          options: [
            {
              value: "token",
              label: "Access Token (recommended for bots)",
            },
            { value: "password", label: "Password" },
          ],
        })) as string;
        if (authMethod === "token") {
          accessToken = String(
            await prompter.text({
              message: "Enter Matrix access token",
              validate: (value: string) =>
                value?.trim() ? undefined : "Required",
            }),
          ).trim();
        } else {
          password = String(
            await prompter.text({
              message: "Enter Matrix password",
              validate: (value: string) =>
                value?.trim() ? undefined : "Required",
            }),
          ).trim();
        }
      }
    } else {
      // No existing credentials, prompt for all
      homeserver = String(
        await prompter.text({
          message: "Enter Matrix homeserver URL (e.g., https://matrix.org)",
          initialValue: resolvedAccount.homeserver || undefined,
          validate: (value: string) => (value?.trim() ? undefined : "Required"),
        }),
      ).trim();
      userId = String(
        await prompter.text({
          message: "Enter Matrix user ID (e.g., @bot:matrix.org)",
          initialValue: resolvedAccount.userId || undefined,
          validate: (value: string) => (value?.trim() ? undefined : "Required"),
        }),
      ).trim();
      const authMethod = (await prompter.select({
        message: "Authentication method",
        options: [
          {
            value: "token",
            label: "Access Token (recommended for bots)",
          },
          { value: "password", label: "Password" },
        ],
      })) as string;
      if (authMethod === "token") {
        accessToken = String(
          await prompter.text({
            message: "Enter Matrix access token",
            validate: (value: string) =>
              value?.trim() ? undefined : "Required",
          }),
        ).trim();
      } else {
        password = String(
          await prompter.text({
            message: "Enter Matrix password",
            validate: (value: string) =>
              value?.trim() ? undefined : "Required",
          }),
        ).trim();
      }
    }

    // Apply the configuration
    if (homeserver && userId && (accessToken || password)) {
      if (matrixAccountId === DEFAULT_ACCOUNT_ID) {
        next = {
          ...next,
          channels: {
            ...next.channels,
            matrix: {
              ...next.channels?.matrix,
              enabled: true,
              homeserver,
              userId,
              ...(accessToken ? { accessToken } : {}),
              ...(password ? { password } : {}),
            },
          },
        } as ClawdbotConfig;
      } else {
        next = {
          ...next,
          channels: {
            ...next.channels,
            matrix: {
              ...next.channels?.matrix,
              enabled: true,
              accounts: {
                ...next.channels?.matrix?.accounts,
                [matrixAccountId]: {
                  ...next.channels?.matrix?.accounts?.[matrixAccountId],
                  enabled:
                    next.channels?.matrix?.accounts?.[matrixAccountId]
                      ?.enabled ?? true,
                  homeserver,
                  userId,
                  ...(accessToken ? { accessToken } : {}),
                  ...(password ? { password } : {}),
                },
              },
            },
          },
        } as ClawdbotConfig;
      }
    }

    return { cfg: next, accountId: matrixAccountId };
  },
  dmPolicy,
  disable: (cfg) =>
    ({
      ...cfg,
      channels: {
        ...cfg.channels,
        matrix: { ...cfg.channels?.matrix, enabled: false },
      },
    }) as ClawdbotConfig,
};
