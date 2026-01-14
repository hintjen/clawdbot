import { describe, expect, it } from "vitest";

import {
  allowListMatchesUser,
  isMatrixRoomAllowed,
  isMatrixRoomAllowedByPolicy,
  isMatrixRoomUserAllowed,
  isMatrixUserAllowed,
  normalizeMatrixAllowList,
  normalizeMatrixUserId,
  resolveMatrixRoomConfig,
  resolveMatrixShouldRequireMention,
  shouldEmitMatrixReactionNotification,
} from "./allow-list.js";

describe("normalizeMatrixUserId", () => {
  it("lowercases user ID", () => {
    expect(normalizeMatrixUserId("@Alice:Matrix.Org")).toBe("@alice:matrix.org");
  });

  it("trims whitespace", () => {
    expect(normalizeMatrixUserId("  @alice:matrix.org  ")).toBe("@alice:matrix.org");
  });

  it("handles already lowercase IDs", () => {
    expect(normalizeMatrixUserId("@alice:matrix.org")).toBe("@alice:matrix.org");
  });

  it("handles mixed case server", () => {
    expect(normalizeMatrixUserId("@bob:Example.COM")).toBe("@bob:example.com");
  });
});

describe("normalizeMatrixAllowList", () => {
  describe("empty/undefined input", () => {
    it("returns empty allowlist for undefined", () => {
      const result = normalizeMatrixAllowList(undefined);
      expect(result.allowAll).toBe(false);
      expect(result.userIds.size).toBe(0);
      expect(result.domains.size).toBe(0);
    });

    it("returns empty allowlist for empty array", () => {
      const result = normalizeMatrixAllowList([]);
      expect(result.allowAll).toBe(false);
      expect(result.userIds.size).toBe(0);
      expect(result.domains.size).toBe(0);
    });

    it("returns empty allowlist for null-like input", () => {
      const result = normalizeMatrixAllowList(null as unknown as string[]);
      expect(result.allowAll).toBe(false);
      expect(result.userIds.size).toBe(0);
      expect(result.domains.size).toBe(0);
    });
  });

  describe("wildcard handling", () => {
    it("sets allowAll for * wildcard", () => {
      const result = normalizeMatrixAllowList(["*"]);
      expect(result.allowAll).toBe(true);
    });

    it("sets allowAll with other entries", () => {
      const result = normalizeMatrixAllowList(["@alice:matrix.org", "*"]);
      expect(result.allowAll).toBe(true);
      expect(result.userIds.has("@alice:matrix.org")).toBe(true);
    });
  });

  describe("domain wildcards", () => {
    it("extracts domain from *:server pattern", () => {
      const result = normalizeMatrixAllowList(["*:matrix.org"]);
      expect(result.domains.has("matrix.org")).toBe(true);
    });

    it("lowercases domain", () => {
      const result = normalizeMatrixAllowList(["*:Matrix.ORG"]);
      expect(result.domains.has("matrix.org")).toBe(true);
    });

    it("handles multiple domain wildcards", () => {
      const result = normalizeMatrixAllowList(["*:matrix.org", "*:example.com"]);
      expect(result.domains.has("matrix.org")).toBe(true);
      expect(result.domains.has("example.com")).toBe(true);
    });

    it("ignores empty domain after *:", () => {
      const result = normalizeMatrixAllowList(["*:"]);
      expect(result.domains.size).toBe(0);
    });
  });

  describe("user IDs", () => {
    it("normalizes and adds user IDs", () => {
      const result = normalizeMatrixAllowList(["@alice:matrix.org"]);
      expect(result.userIds.has("@alice:matrix.org")).toBe(true);
    });

    it("lowercases user IDs", () => {
      const result = normalizeMatrixAllowList(["@Alice:Matrix.Org"]);
      expect(result.userIds.has("@alice:matrix.org")).toBe(true);
    });

    it("trims whitespace from user IDs", () => {
      const result = normalizeMatrixAllowList(["  @alice:matrix.org  "]);
      expect(result.userIds.has("@alice:matrix.org")).toBe(true);
    });

    it("handles multiple user IDs", () => {
      const result = normalizeMatrixAllowList(["@alice:matrix.org", "@bob:example.com"]);
      expect(result.userIds.has("@alice:matrix.org")).toBe(true);
      expect(result.userIds.has("@bob:example.com")).toBe(true);
    });

    it("skips empty strings", () => {
      const result = normalizeMatrixAllowList(["", "@alice:matrix.org", "  "]);
      expect(result.userIds.size).toBe(1);
      expect(result.userIds.has("@alice:matrix.org")).toBe(true);
    });
  });

  describe("mixed entries", () => {
    it("handles mix of wildcards, domains, and user IDs", () => {
      const result = normalizeMatrixAllowList([
        "@alice:matrix.org",
        "*:example.com",
        "@bob:test.org",
      ]);
      expect(result.allowAll).toBe(false);
      expect(result.userIds.has("@alice:matrix.org")).toBe(true);
      expect(result.userIds.has("@bob:test.org")).toBe(true);
      expect(result.domains.has("example.com")).toBe(true);
    });
  });
});

describe("allowListMatchesUser", () => {
  it("returns true when allowAll is set", () => {
    const allowList = normalizeMatrixAllowList(["*"]);
    expect(allowListMatchesUser("@anyone:anywhere.com", allowList)).toBe(true);
  });

  it("matches exact user ID", () => {
    const allowList = normalizeMatrixAllowList(["@alice:matrix.org"]);
    expect(allowListMatchesUser("@alice:matrix.org", allowList)).toBe(true);
  });

  it("matches user ID case-insensitively", () => {
    const allowList = normalizeMatrixAllowList(["@alice:matrix.org"]);
    expect(allowListMatchesUser("@Alice:Matrix.Org", allowList)).toBe(true);
  });

  it("does not match non-listed user", () => {
    const allowList = normalizeMatrixAllowList(["@alice:matrix.org"]);
    expect(allowListMatchesUser("@bob:matrix.org", allowList)).toBe(false);
  });

  it("matches user by domain wildcard", () => {
    const allowList = normalizeMatrixAllowList(["*:matrix.org"]);
    expect(allowListMatchesUser("@anyuser:matrix.org", allowList)).toBe(true);
  });

  it("does not match user from different domain", () => {
    const allowList = normalizeMatrixAllowList(["*:matrix.org"]);
    expect(allowListMatchesUser("@user:example.com", allowList)).toBe(false);
  });

  it("matches domain wildcard case-insensitively", () => {
    const allowList = normalizeMatrixAllowList(["*:Matrix.ORG"]);
    expect(allowListMatchesUser("@user:matrix.org", allowList)).toBe(true);
  });

  it("returns false for empty allowlist", () => {
    const allowList = normalizeMatrixAllowList([]);
    expect(allowListMatchesUser("@alice:matrix.org", allowList)).toBe(false);
  });
});

describe("isMatrixUserAllowed", () => {
  describe("open policy", () => {
    it("allows any user with open policy", () => {
      expect(
        isMatrixUserAllowed({
          userId: "@anyone:anywhere.com",
          dmPolicy: "open",
        }),
      ).toBe(true);
    });

    it("allows user even without allowFrom list", () => {
      expect(
        isMatrixUserAllowed({
          userId: "@user:matrix.org",
          dmPolicy: "open",
          allowFrom: undefined,
        }),
      ).toBe(true);
    });
  });

  describe("disabled policy", () => {
    it("blocks all users with disabled policy", () => {
      expect(
        isMatrixUserAllowed({
          userId: "@alice:matrix.org",
          dmPolicy: "disabled",
          allowFrom: ["@alice:matrix.org"],
        }),
      ).toBe(false);
    });

    it("blocks users even with wildcard allowFrom", () => {
      expect(
        isMatrixUserAllowed({
          userId: "@alice:matrix.org",
          dmPolicy: "disabled",
          allowFrom: ["*"],
        }),
      ).toBe(false);
    });
  });

  describe("pairing policy", () => {
    it("blocks users when no allowFrom list configured", () => {
      expect(
        isMatrixUserAllowed({
          userId: "@alice:matrix.org",
          dmPolicy: "pairing",
        }),
      ).toBe(false);
    });

    it("blocks users when allowFrom is empty", () => {
      expect(
        isMatrixUserAllowed({
          userId: "@alice:matrix.org",
          dmPolicy: "pairing",
          allowFrom: [],
        }),
      ).toBe(false);
    });

    it("allows users explicitly in allowFrom list", () => {
      expect(
        isMatrixUserAllowed({
          userId: "@alice:matrix.org",
          dmPolicy: "pairing",
          allowFrom: ["@alice:matrix.org"],
        }),
      ).toBe(true);
    });

    it("allows users matching domain wildcard", () => {
      expect(
        isMatrixUserAllowed({
          userId: "@alice:matrix.org",
          dmPolicy: "pairing",
          allowFrom: ["*:matrix.org"],
        }),
      ).toBe(true);
    });

    it("allows any user with universal wildcard", () => {
      expect(
        isMatrixUserAllowed({
          userId: "@random:someserver.com",
          dmPolicy: "pairing",
          allowFrom: ["*"],
        }),
      ).toBe(true);
    });

    it("blocks users not in allowFrom list", () => {
      expect(
        isMatrixUserAllowed({
          userId: "@bob:matrix.org",
          dmPolicy: "pairing",
          allowFrom: ["@alice:matrix.org"],
        }),
      ).toBe(false);
    });
  });
});

describe("isMatrixRoomAllowed", () => {
  describe("disabled policy", () => {
    it("blocks all rooms", () => {
      expect(
        isMatrixRoomAllowed({
          roomId: "!room:matrix.org",
          groupPolicy: "disabled",
        }),
      ).toBe(false);
    });

    it("blocks rooms even with matching config", () => {
      expect(
        isMatrixRoomAllowed({
          roomId: "!room:matrix.org",
          groupPolicy: "disabled",
          roomsConfig: { "!room:matrix.org": { enabled: true } },
        }),
      ).toBe(false);
    });
  });

  describe("open policy", () => {
    it("allows all rooms", () => {
      expect(
        isMatrixRoomAllowed({
          roomId: "!room:matrix.org",
          groupPolicy: "open",
        }),
      ).toBe(true);
    });

    it("allows rooms without config", () => {
      expect(
        isMatrixRoomAllowed({
          roomId: "!random:server.org",
          groupPolicy: "open",
          roomsConfig: undefined,
        }),
      ).toBe(true);
    });
  });

  describe("allowlist policy", () => {
    it("blocks room not in config", () => {
      expect(
        isMatrixRoomAllowed({
          roomId: "!room:matrix.org",
          groupPolicy: "allowlist",
          roomsConfig: {},
        }),
      ).toBe(false);
    });

    it("blocks room when config is undefined", () => {
      expect(
        isMatrixRoomAllowed({
          roomId: "!room:matrix.org",
          groupPolicy: "allowlist",
        }),
      ).toBe(false);
    });

    it("allows room by room ID", () => {
      expect(
        isMatrixRoomAllowed({
          roomId: "!room:matrix.org",
          groupPolicy: "allowlist",
          roomsConfig: { "!room:matrix.org": { enabled: true } },
        }),
      ).toBe(true);
    });

    it("allows room by alias", () => {
      expect(
        isMatrixRoomAllowed({
          roomId: "!room:matrix.org",
          roomAlias: "#general:matrix.org",
          groupPolicy: "allowlist",
          roomsConfig: { "#general:matrix.org": {} },
        }),
      ).toBe(true);
    });

    it("allows room by name", () => {
      expect(
        isMatrixRoomAllowed({
          roomId: "!room:matrix.org",
          roomName: "General Chat",
          groupPolicy: "allowlist",
          roomsConfig: { "General Chat": {} },
        }),
      ).toBe(true);
    });

    it("allows room by wildcard", () => {
      expect(
        isMatrixRoomAllowed({
          roomId: "!anyroom:anyserver.com",
          groupPolicy: "allowlist",
          roomsConfig: { "*": {} },
        }),
      ).toBe(true);
    });

    it("blocks room when explicitly disabled", () => {
      expect(
        isMatrixRoomAllowed({
          roomId: "!room:matrix.org",
          groupPolicy: "allowlist",
          roomsConfig: { "!room:matrix.org": { enabled: false } },
        }),
      ).toBe(false);
    });

    it("blocks room when allow is false", () => {
      expect(
        isMatrixRoomAllowed({
          roomId: "!room:matrix.org",
          groupPolicy: "allowlist",
          roomsConfig: { "!room:matrix.org": { allow: false } },
        }),
      ).toBe(false);
    });
  });
});

describe("resolveMatrixRoomConfig", () => {
  describe("no config", () => {
    it("returns null when roomsConfig is undefined", () => {
      expect(
        resolveMatrixRoomConfig({
          roomId: "!room:matrix.org",
        }),
      ).toBeNull();
    });

    it("returns null when room not found", () => {
      expect(
        resolveMatrixRoomConfig({
          roomId: "!room:matrix.org",
          roomsConfig: {},
        }),
      ).toBeNull();
    });
  });

  describe("lookup by room ID", () => {
    it("finds room by exact ID match", () => {
      const result = resolveMatrixRoomConfig({
        roomId: "!room:matrix.org",
        roomsConfig: {
          "!room:matrix.org": { requireMention: true, systemPrompt: "test" },
        },
      });
      expect(result).not.toBeNull();
      expect(result?.allowed).toBe(true);
      expect(result?.requireMention).toBe(true);
      expect(result?.systemPrompt).toBe("test");
    });
  });

  describe("lookup by alias", () => {
    it("finds room by alias with hash", () => {
      const result = resolveMatrixRoomConfig({
        roomId: "!room:matrix.org",
        roomAlias: "#general:matrix.org",
        roomsConfig: { "#general:matrix.org": { users: ["@admin:matrix.org"] } },
      });
      expect(result).not.toBeNull();
      expect(result?.users).toContain("@admin:matrix.org");
    });

    it("finds room by alias without hash", () => {
      const result = resolveMatrixRoomConfig({
        roomId: "!room:matrix.org",
        roomAlias: "#general:matrix.org",
        roomsConfig: { "general:matrix.org": { skills: ["math"] } },
      });
      expect(result).not.toBeNull();
      expect(result?.skills).toContain("math");
    });

    it("prefers room ID over alias", () => {
      const result = resolveMatrixRoomConfig({
        roomId: "!room:matrix.org",
        roomAlias: "#general:matrix.org",
        roomsConfig: {
          "!room:matrix.org": { systemPrompt: "by-id" },
          "#general:matrix.org": { systemPrompt: "by-alias" },
        },
      });
      expect(result?.systemPrompt).toBe("by-id");
    });
  });

  describe("lookup by name", () => {
    it("finds room by name", () => {
      const result = resolveMatrixRoomConfig({
        roomId: "!room:matrix.org",
        roomName: "General Chat",
        roomsConfig: { "General Chat": { requireMention: false } },
      });
      expect(result).not.toBeNull();
      expect(result?.requireMention).toBe(false);
    });

    it("prefers alias over name", () => {
      const result = resolveMatrixRoomConfig({
        roomId: "!room:matrix.org",
        roomAlias: "#general:matrix.org",
        roomName: "General Chat",
        roomsConfig: {
          "#general:matrix.org": { systemPrompt: "by-alias" },
          "General Chat": { systemPrompt: "by-name" },
        },
      });
      expect(result?.systemPrompt).toBe("by-alias");
    });
  });

  describe("wildcard fallback", () => {
    it("falls back to wildcard when no specific match", () => {
      const result = resolveMatrixRoomConfig({
        roomId: "!room:matrix.org",
        roomsConfig: { "*": { requireMention: true } },
      });
      expect(result).not.toBeNull();
      expect(result?.requireMention).toBe(true);
    });

    it("prefers specific match over wildcard", () => {
      const result = resolveMatrixRoomConfig({
        roomId: "!room:matrix.org",
        roomsConfig: {
          "!room:matrix.org": { systemPrompt: "specific" },
          "*": { systemPrompt: "wildcard" },
        },
      });
      expect(result?.systemPrompt).toBe("specific");
    });
  });

  describe("allowed resolution", () => {
    it("room is allowed by default", () => {
      const result = resolveMatrixRoomConfig({
        roomId: "!room:matrix.org",
        roomsConfig: { "!room:matrix.org": {} },
      });
      expect(result?.allowed).toBe(true);
    });

    it("room is blocked when enabled is false", () => {
      const result = resolveMatrixRoomConfig({
        roomId: "!room:matrix.org",
        roomsConfig: { "!room:matrix.org": { enabled: false } },
      });
      expect(result?.allowed).toBe(false);
      expect(result?.enabled).toBe(false);
    });

    it("room is blocked when allow is false", () => {
      const result = resolveMatrixRoomConfig({
        roomId: "!room:matrix.org",
        roomsConfig: { "!room:matrix.org": { allow: false } },
      });
      expect(result?.allowed).toBe(false);
    });

    it("room is blocked when both enabled and allow are false", () => {
      const result = resolveMatrixRoomConfig({
        roomId: "!room:matrix.org",
        roomsConfig: { "!room:matrix.org": { enabled: false, allow: false } },
      });
      expect(result?.allowed).toBe(false);
    });

    it("room is allowed when enabled is true and allow is unset", () => {
      const result = resolveMatrixRoomConfig({
        roomId: "!room:matrix.org",
        roomsConfig: { "!room:matrix.org": { enabled: true } },
      });
      expect(result?.allowed).toBe(true);
    });
  });
});

describe("resolveMatrixShouldRequireMention", () => {
  describe("DM behavior", () => {
    it("never requires mention for DMs", () => {
      expect(
        resolveMatrixShouldRequireMention({
          isDirect: true,
          roomConfig: { allowed: true, requireMention: true },
        }),
      ).toBe(false);
    });

    it("ignores account default for DMs", () => {
      expect(
        resolveMatrixShouldRequireMention({
          isDirect: true,
          accountRequireMention: true,
        }),
      ).toBe(false);
    });
  });

  describe("room-specific config", () => {
    it("uses room config when set to true", () => {
      expect(
        resolveMatrixShouldRequireMention({
          isDirect: false,
          roomConfig: { allowed: true, requireMention: true },
        }),
      ).toBe(true);
    });

    it("uses room config when set to false", () => {
      expect(
        resolveMatrixShouldRequireMention({
          isDirect: false,
          roomConfig: { allowed: true, requireMention: false },
        }),
      ).toBe(false);
    });

    it("overrides account default with room config", () => {
      expect(
        resolveMatrixShouldRequireMention({
          isDirect: false,
          roomConfig: { allowed: true, requireMention: false },
          accountRequireMention: true,
        }),
      ).toBe(false);
    });
  });

  describe("account default", () => {
    it("uses account default when room config is null", () => {
      expect(
        resolveMatrixShouldRequireMention({
          isDirect: false,
          roomConfig: null,
          accountRequireMention: false,
        }),
      ).toBe(false);
    });

    it("uses account default when requireMention not set in room config", () => {
      expect(
        resolveMatrixShouldRequireMention({
          isDirect: false,
          roomConfig: { allowed: true },
          accountRequireMention: false,
        }),
      ).toBe(false);
    });
  });

  describe("default behavior", () => {
    it("defaults to true for rooms when nothing configured", () => {
      expect(
        resolveMatrixShouldRequireMention({
          isDirect: false,
        }),
      ).toBe(true);
    });

    it("defaults to true when roomConfig is undefined", () => {
      expect(
        resolveMatrixShouldRequireMention({
          isDirect: false,
          roomConfig: undefined,
        }),
      ).toBe(true);
    });
  });
});

describe("isMatrixRoomUserAllowed", () => {
  it("allows all users when no room config", () => {
    expect(
      isMatrixRoomUserAllowed({
        userId: "@anyone:matrix.org",
      }),
    ).toBe(true);
  });

  it("allows all users when room config has no users list", () => {
    expect(
      isMatrixRoomUserAllowed({
        userId: "@anyone:matrix.org",
        roomConfig: { allowed: true },
      }),
    ).toBe(true);
  });

  it("allows all users when room config has empty users list", () => {
    expect(
      isMatrixRoomUserAllowed({
        userId: "@anyone:matrix.org",
        roomConfig: { allowed: true, users: [] },
      }),
    ).toBe(true);
  });

  it("allows users in the room users list", () => {
    expect(
      isMatrixRoomUserAllowed({
        userId: "@alice:matrix.org",
        roomConfig: { allowed: true, users: ["@alice:matrix.org"] },
      }),
    ).toBe(true);
  });

  it("blocks users not in the room users list", () => {
    expect(
      isMatrixRoomUserAllowed({
        userId: "@bob:matrix.org",
        roomConfig: { allowed: true, users: ["@alice:matrix.org"] },
      }),
    ).toBe(false);
  });

  it("supports domain wildcards in room users list", () => {
    expect(
      isMatrixRoomUserAllowed({
        userId: "@anyuser:matrix.org",
        roomConfig: { allowed: true, users: ["*:matrix.org"] },
      }),
    ).toBe(true);
  });

  it("supports universal wildcard in room users list", () => {
    expect(
      isMatrixRoomUserAllowed({
        userId: "@anyone:anywhere.com",
        roomConfig: { allowed: true, users: ["*"] },
      }),
    ).toBe(true);
  });

  it("matches users case-insensitively", () => {
    expect(
      isMatrixRoomUserAllowed({
        userId: "@ALICE:Matrix.Org",
        roomConfig: { allowed: true, users: ["@alice:matrix.org"] },
      }),
    ).toBe(true);
  });
});

describe("shouldEmitMatrixReactionNotification", () => {
  const botUserId = "@bot:matrix.org";

  describe("off mode", () => {
    it("never emits notifications", () => {
      expect(
        shouldEmitMatrixReactionNotification({
          mode: "off",
          botUserId,
          messageAuthorId: botUserId,
          reactorUserId: "@alice:matrix.org",
        }),
      ).toBe(false);
    });
  });

  describe("all mode", () => {
    it("always emits notifications", () => {
      expect(
        shouldEmitMatrixReactionNotification({
          mode: "all",
          botUserId,
          messageAuthorId: "@alice:matrix.org",
          reactorUserId: "@bob:matrix.org",
        }),
      ).toBe(true);
    });

    it("emits for reactions on bot messages", () => {
      expect(
        shouldEmitMatrixReactionNotification({
          mode: "all",
          botUserId,
          messageAuthorId: botUserId,
          reactorUserId: "@alice:matrix.org",
        }),
      ).toBe(true);
    });
  });

  describe("own mode", () => {
    it("emits for reactions on bot's own messages", () => {
      expect(
        shouldEmitMatrixReactionNotification({
          mode: "own",
          botUserId,
          messageAuthorId: botUserId,
          reactorUserId: "@alice:matrix.org",
        }),
      ).toBe(true);
    });

    it("does not emit for reactions on other messages", () => {
      expect(
        shouldEmitMatrixReactionNotification({
          mode: "own",
          botUserId,
          messageAuthorId: "@alice:matrix.org",
          reactorUserId: "@bob:matrix.org",
        }),
      ).toBe(false);
    });

    it("handles undefined message author", () => {
      expect(
        shouldEmitMatrixReactionNotification({
          mode: "own",
          botUserId,
          messageAuthorId: undefined,
          reactorUserId: "@alice:matrix.org",
        }),
      ).toBe(false);
    });
  });

  describe("allowlist mode", () => {
    it("emits when reactor is in allowlist", () => {
      expect(
        shouldEmitMatrixReactionNotification({
          mode: "allowlist",
          botUserId,
          reactorUserId: "@alice:matrix.org",
          reactionAllowlist: ["@alice:matrix.org"],
        }),
      ).toBe(true);
    });

    it("does not emit when reactor not in allowlist", () => {
      expect(
        shouldEmitMatrixReactionNotification({
          mode: "allowlist",
          botUserId,
          reactorUserId: "@bob:matrix.org",
          reactionAllowlist: ["@alice:matrix.org"],
        }),
      ).toBe(false);
    });

    it("does not emit with empty allowlist", () => {
      expect(
        shouldEmitMatrixReactionNotification({
          mode: "allowlist",
          botUserId,
          reactorUserId: "@alice:matrix.org",
          reactionAllowlist: [],
        }),
      ).toBe(false);
    });

    it("does not emit with undefined allowlist", () => {
      expect(
        shouldEmitMatrixReactionNotification({
          mode: "allowlist",
          botUserId,
          reactorUserId: "@alice:matrix.org",
          reactionAllowlist: undefined,
        }),
      ).toBe(false);
    });

    it("supports domain wildcard in allowlist", () => {
      expect(
        shouldEmitMatrixReactionNotification({
          mode: "allowlist",
          botUserId,
          reactorUserId: "@anyone:matrix.org",
          reactionAllowlist: ["*:matrix.org"],
        }),
      ).toBe(true);
    });

    it("supports universal wildcard in allowlist", () => {
      expect(
        shouldEmitMatrixReactionNotification({
          mode: "allowlist",
          botUserId,
          reactorUserId: "@anyone:anywhere.com",
          reactionAllowlist: ["*"],
        }),
      ).toBe(true);
    });
  });
});

describe("isMatrixRoomAllowedByPolicy", () => {
  describe("disabled policy", () => {
    it("returns false regardless of config", () => {
      expect(
        isMatrixRoomAllowedByPolicy({
          groupPolicy: "disabled",
          roomAllowlistConfigured: true,
          roomAllowed: true,
        }),
      ).toBe(false);
    });
  });

  describe("open policy", () => {
    it("returns true regardless of config", () => {
      expect(
        isMatrixRoomAllowedByPolicy({
          groupPolicy: "open",
          roomAllowlistConfigured: false,
          roomAllowed: false,
        }),
      ).toBe(true);
    });
  });

  describe("allowlist policy", () => {
    it("returns true when configured and allowed", () => {
      expect(
        isMatrixRoomAllowedByPolicy({
          groupPolicy: "allowlist",
          roomAllowlistConfigured: true,
          roomAllowed: true,
        }),
      ).toBe(true);
    });

    it("returns false when not configured", () => {
      expect(
        isMatrixRoomAllowedByPolicy({
          groupPolicy: "allowlist",
          roomAllowlistConfigured: false,
          roomAllowed: true,
        }),
      ).toBe(false);
    });

    it("returns false when configured but not allowed", () => {
      expect(
        isMatrixRoomAllowedByPolicy({
          groupPolicy: "allowlist",
          roomAllowlistConfigured: true,
          roomAllowed: false,
        }),
      ).toBe(false);
    });
  });

  describe("unknown policy", () => {
    it("returns false for unknown policy", () => {
      expect(
        isMatrixRoomAllowedByPolicy({
          groupPolicy: "unknown" as "allowlist",
          roomAllowlistConfigured: true,
          roomAllowed: true,
        }),
      ).toBe(false);
    });
  });
});
