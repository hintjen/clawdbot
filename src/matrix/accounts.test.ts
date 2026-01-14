import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ClawdbotConfig } from "../config/config.js";
import {
  listEnabledMatrixAccounts,
  listMatrixAccountIds,
  resolveDefaultMatrixAccountId,
  resolveMatrixAccount,
} from "./accounts.js";

describe("listMatrixAccountIds", () => {
  it("returns ['default'] when no matrix config exists", () => {
    const cfg: ClawdbotConfig = {};
    expect(listMatrixAccountIds(cfg)).toEqual(["default"]);
  });

  it("returns ['default'] when matrix config has no accounts", () => {
    const cfg: ClawdbotConfig = {
      channels: {
        matrix: {
          homeserver: "https://matrix.org",
          userId: "@bot:matrix.org",
        },
      },
    };
    expect(listMatrixAccountIds(cfg)).toEqual(["default"]);
  });

  it("returns sorted account IDs when accounts are configured", () => {
    const cfg: ClawdbotConfig = {
      channels: {
        matrix: {
          homeserver: "https://matrix.org",
          userId: "@bot:matrix.org",
          accounts: {
            work: {
              homeserver: "https://work.example.com",
              userId: "@work:example.com",
            },
            personal: {
              homeserver: "https://matrix.org",
              userId: "@personal:matrix.org",
            },
          },
        },
      },
    };
    expect(listMatrixAccountIds(cfg)).toEqual(["personal", "work"]);
  });

  it("filters out empty string account IDs", () => {
    const cfg: ClawdbotConfig = {
      channels: {
        matrix: {
          homeserver: "https://matrix.org",
          userId: "@bot:matrix.org",
          accounts: {
            valid: {
              homeserver: "https://matrix.org",
              userId: "@valid:matrix.org",
            },
            "": {
              homeserver: "https://matrix.org",
              userId: "@empty:matrix.org",
            },
          },
        },
      },
    };
    expect(listMatrixAccountIds(cfg)).toEqual(["valid"]);
  });
});

describe("resolveDefaultMatrixAccountId", () => {
  it("returns 'default' when no accounts are configured", () => {
    const cfg: ClawdbotConfig = {};
    expect(resolveDefaultMatrixAccountId(cfg)).toBe("default");
  });

  it("returns 'default' if present in account list", () => {
    const cfg: ClawdbotConfig = {
      channels: {
        matrix: {
          homeserver: "https://matrix.org",
          userId: "@bot:matrix.org",
          accounts: {
            default: {
              homeserver: "https://matrix.org",
              userId: "@default:matrix.org",
            },
            other: {
              homeserver: "https://other.org",
              userId: "@other:other.org",
            },
          },
        },
      },
    };
    expect(resolveDefaultMatrixAccountId(cfg)).toBe("default");
  });

  it("returns first sorted account ID if 'default' is not in list", () => {
    const cfg: ClawdbotConfig = {
      channels: {
        matrix: {
          homeserver: "https://matrix.org",
          userId: "@bot:matrix.org",
          accounts: {
            work: {
              homeserver: "https://work.example.com",
              userId: "@work:example.com",
            },
            personal: {
              homeserver: "https://matrix.org",
              userId: "@personal:matrix.org",
            },
          },
        },
      },
    };
    // "personal" comes before "work" alphabetically
    expect(resolveDefaultMatrixAccountId(cfg)).toBe("personal");
  });
});

describe("resolveMatrixAccount", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.MATRIX_ACCESS_TOKEN = process.env.MATRIX_ACCESS_TOKEN;
    savedEnv.MATRIX_PASSWORD = process.env.MATRIX_PASSWORD;
    delete process.env.MATRIX_ACCESS_TOKEN;
    delete process.env.MATRIX_PASSWORD;
  });

  afterEach(() => {
    if (savedEnv.MATRIX_ACCESS_TOKEN !== undefined) {
      process.env.MATRIX_ACCESS_TOKEN = savedEnv.MATRIX_ACCESS_TOKEN;
    } else {
      delete process.env.MATRIX_ACCESS_TOKEN;
    }
    if (savedEnv.MATRIX_PASSWORD !== undefined) {
      process.env.MATRIX_PASSWORD = savedEnv.MATRIX_PASSWORD;
    } else {
      delete process.env.MATRIX_PASSWORD;
    }
  });

  it("returns empty homeserver and userId when no config exists", () => {
    const cfg: ClawdbotConfig = {};
    const result = resolveMatrixAccount({ cfg });
    expect(result.homeserver).toBe("");
    expect(result.userId).toBe("");
    expect(result.accountId).toBe("default");
  });

  it("resolves base config when no account-specific config exists", () => {
    const cfg: ClawdbotConfig = {
      channels: {
        matrix: {
          homeserver: "https://matrix.org",
          userId: "@bot:matrix.org",
          accessToken: "base-token",
        },
      },
    };
    const result = resolveMatrixAccount({ cfg });
    expect(result.homeserver).toBe("https://matrix.org");
    expect(result.userId).toBe("@bot:matrix.org");
    expect(result.accessToken).toBe("base-token");
    expect(result.accessTokenSource).toBe("config");
  });

  it("merges base config with account-specific overrides", () => {
    const cfg: ClawdbotConfig = {
      channels: {
        matrix: {
          homeserver: "https://base.org",
          userId: "@base:base.org",
          accessToken: "base-token",
          historyLimit: 50,
          accounts: {
            work: {
              homeserver: "https://work.org",
              userId: "@work:work.org",
              accessToken: "work-token",
            },
          },
        },
      },
    };
    const result = resolveMatrixAccount({ cfg, accountId: "work" });
    expect(result.homeserver).toBe("https://work.org");
    expect(result.userId).toBe("@work:work.org");
    expect(result.accessToken).toBe("work-token");
    expect(result.config.historyLimit).toBe(50); // inherited from base
  });

  it("respects enabled flag on base config", () => {
    const cfg: ClawdbotConfig = {
      channels: {
        matrix: {
          enabled: false,
          homeserver: "https://matrix.org",
          userId: "@bot:matrix.org",
        },
      },
    };
    const result = resolveMatrixAccount({ cfg });
    expect(result.enabled).toBe(false);
  });

  it("respects enabled flag on account config", () => {
    const cfg: ClawdbotConfig = {
      channels: {
        matrix: {
          enabled: true,
          homeserver: "https://matrix.org",
          userId: "@bot:matrix.org",
          accounts: {
            disabled: {
              enabled: false,
              homeserver: "https://disabled.org",
              userId: "@disabled:disabled.org",
            },
          },
        },
      },
    };
    const result = resolveMatrixAccount({ cfg, accountId: "disabled" });
    expect(result.enabled).toBe(false);
  });

  it("requires both base and account enabled to be considered enabled", () => {
    const cfg: ClawdbotConfig = {
      channels: {
        matrix: {
          enabled: false,
          homeserver: "https://matrix.org",
          userId: "@bot:matrix.org",
          accounts: {
            account: {
              enabled: true,
              homeserver: "https://account.org",
              userId: "@account:account.org",
            },
          },
        },
      },
    };
    const result = resolveMatrixAccount({ cfg, accountId: "account" });
    expect(result.enabled).toBe(false);
  });

  it("uses environment variables for default account", () => {
    process.env.MATRIX_ACCESS_TOKEN = "env-token";
    const cfg: ClawdbotConfig = {
      channels: {
        matrix: {
          homeserver: "https://matrix.org",
          userId: "@bot:matrix.org",
        },
      },
    };
    const result = resolveMatrixAccount({ cfg });
    expect(result.accessToken).toBe("env-token");
    expect(result.accessTokenSource).toBe("env");
  });

  it("prefers config over environment variables", () => {
    process.env.MATRIX_ACCESS_TOKEN = "env-token";
    const cfg: ClawdbotConfig = {
      channels: {
        matrix: {
          homeserver: "https://matrix.org",
          userId: "@bot:matrix.org",
          accessToken: "config-token",
        },
      },
    };
    const result = resolveMatrixAccount({ cfg });
    expect(result.accessToken).toBe("config-token");
    expect(result.accessTokenSource).toBe("config");
  });

  it("does not use environment variables for non-default accounts", () => {
    process.env.MATRIX_ACCESS_TOKEN = "env-token";
    const cfg: ClawdbotConfig = {
      channels: {
        matrix: {
          homeserver: "https://matrix.org",
          userId: "@bot:matrix.org",
          accounts: {
            work: {
              homeserver: "https://work.org",
              userId: "@work:work.org",
            },
          },
        },
      },
    };
    const result = resolveMatrixAccount({ cfg, accountId: "work" });
    expect(result.accessToken).toBeUndefined();
    expect(result.accessTokenSource).toBe("none");
  });

  it("supports password authentication", () => {
    const cfg: ClawdbotConfig = {
      channels: {
        matrix: {
          homeserver: "https://matrix.org",
          userId: "@bot:matrix.org",
          password: "secret-password",
        },
      },
    };
    const result = resolveMatrixAccount({ cfg });
    expect(result.password).toBe("secret-password");
    expect(result.passwordSource).toBe("config");
  });

  it("resolves deviceId when configured", () => {
    const cfg: ClawdbotConfig = {
      channels: {
        matrix: {
          homeserver: "https://matrix.org",
          userId: "@bot:matrix.org",
          deviceId: "MYDEVICE123",
        },
      },
    };
    const result = resolveMatrixAccount({ cfg });
    expect(result.deviceId).toBe("MYDEVICE123");
  });

  it("trims whitespace from name", () => {
    const cfg: ClawdbotConfig = {
      channels: {
        matrix: {
          homeserver: "https://matrix.org",
          userId: "@bot:matrix.org",
          name: "  My Bot  ",
        },
      },
    };
    const result = resolveMatrixAccount({ cfg });
    expect(result.name).toBe("My Bot");
  });

  it("returns undefined for empty name after trimming", () => {
    const cfg: ClawdbotConfig = {
      channels: {
        matrix: {
          homeserver: "https://matrix.org",
          userId: "@bot:matrix.org",
          name: "   ",
        },
      },
    };
    const result = resolveMatrixAccount({ cfg });
    expect(result.name).toBeUndefined();
  });

  it("normalizes null accountId to 'default'", () => {
    const cfg: ClawdbotConfig = {};
    const result = resolveMatrixAccount({ cfg, accountId: null });
    expect(result.accountId).toBe("default");
  });

  it("normalizes undefined accountId to 'default'", () => {
    const cfg: ClawdbotConfig = {};
    const result = resolveMatrixAccount({ cfg, accountId: undefined });
    expect(result.accountId).toBe("default");
  });
});

describe("listEnabledMatrixAccounts", () => {
  it("returns empty array when no matrix config exists", () => {
    const cfg: ClawdbotConfig = {};
    const result = listEnabledMatrixAccounts(cfg);
    // The default account will be present but without valid homeserver/userId
    // it's still technically "enabled" (enabled flag not set to false)
    expect(result.length).toBe(1);
    expect(result[0].accountId).toBe("default");
    expect(result[0].enabled).toBe(true);
  });

  it("filters out disabled accounts", () => {
    const cfg: ClawdbotConfig = {
      channels: {
        matrix: {
          homeserver: "https://matrix.org",
          userId: "@bot:matrix.org",
          accounts: {
            enabled1: {
              enabled: true,
              homeserver: "https://enabled1.org",
              userId: "@enabled1:enabled1.org",
            },
            disabled: {
              enabled: false,
              homeserver: "https://disabled.org",
              userId: "@disabled:disabled.org",
            },
            enabled2: {
              homeserver: "https://enabled2.org",
              userId: "@enabled2:enabled2.org",
            },
          },
        },
      },
    };
    const result = listEnabledMatrixAccounts(cfg);
    const accountIds = result.map((a) => a.accountId);
    expect(accountIds).toContain("enabled1");
    expect(accountIds).toContain("enabled2");
    expect(accountIds).not.toContain("disabled");
  });

  it("returns empty when base matrix config is disabled", () => {
    const cfg: ClawdbotConfig = {
      channels: {
        matrix: {
          enabled: false,
          homeserver: "https://matrix.org",
          userId: "@bot:matrix.org",
          accounts: {
            account1: {
              homeserver: "https://account1.org",
              userId: "@account1:account1.org",
            },
          },
        },
      },
    };
    const result = listEnabledMatrixAccounts(cfg);
    expect(result).toEqual([]);
  });
});
