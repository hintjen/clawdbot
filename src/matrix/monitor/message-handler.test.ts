/**
 * Unit tests for Matrix message handler.
 *
 * Tests the message handler factory, preflight checks, and processing helpers.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock external dependencies before imports
vi.mock("../../globals.js", () => ({
  logVerbose: vi.fn(),
  shouldLogVerbose: vi.fn(() => false),
  danger: vi.fn((msg: string) => msg),
}));

vi.mock("../../infra/channel-activity.js", () => ({
  recordChannelActivity: vi.fn(),
}));

vi.mock("../../pairing/pairing-store.js", () => ({
  readChannelAllowFromStore: vi.fn().mockResolvedValue([]),
  upsertChannelPairingRequest: vi.fn().mockResolvedValue({ code: "ABC123", created: true }),
}));

vi.mock("../../pairing/pairing-messages.js", () => ({
  buildPairingReply: vi.fn(() => "Please pair with code: ABC123"),
}));

vi.mock("../../routing/resolve-route.js", () => ({
  resolveAgentRoute: vi.fn(() => ({
    sessionKey: "test-session-key",
    accountId: "test-account",
    agentId: "test-agent",
  })),
}));

vi.mock("../../auto-reply/reply/mentions.js", () => ({
  buildMentionRegexes: vi.fn(() => []),
  matchesMentionPatterns: vi.fn(() => false),
}));

vi.mock("../send.js", () => ({
  sendMessageMatrix: vi.fn().mockResolvedValue({ eventId: "$reply:matrix.org" }),
}));

vi.mock("../format.js", () => ({
  containsMatrixMention: vi.fn(() => false),
}));

// Import after mocks are set up
import type { MatrixMonitorContext } from "./context.js";
import type { MatrixMessageHandler } from "./events/types.js";

/**
 * Create a minimal mock MatrixMonitorContext for testing.
 */
function createMockContext(
  overrides: Partial<MatrixMonitorContext> = {},
): MatrixMonitorContext {
  return {
    cfg: {} as MatrixMonitorContext["cfg"],
    accountId: "test-account",
    client: {
      sendTyping: vi.fn().mockResolvedValue(undefined),
    } as unknown as MatrixMonitorContext["client"],
    runtime: {
      error: vi.fn(),
      log: vi.fn(),
    },
    botUserId: "@bot:matrix.org",
    homeserver: "https://matrix.org",
    historyLimit: 10,
    roomHistories: new Map(),
    sessionScope: "room",
    mainKey: "main-key",
    dmEnabled: true,
    dmPolicy: "pairing",
    allowFrom: ["@allowed:matrix.org"],
    roomsConfig: {},
    groupPolicy: "allowlist",
    reactionMode: "off",
    reactionAllowlist: [],
    replyToMode: "all",
    textLimit: 4000,
    mediaMaxBytes: 10_000_000,
    logger: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    } as unknown as MatrixMonitorContext["logger"],
    markMessageSeen: vi.fn(() => false),
    resolveMatrixSystemEventSessionKey: vi.fn(() => "system-session-key"),
    isRoomAllowed: vi.fn(() => true),
    resolveRoomInfo: vi.fn().mockResolvedValue({
      name: "Test Room",
      isDirect: false,
      memberCount: 5,
    }),
    resolveUserDisplayName: vi.fn().mockResolvedValue({
      displayName: "Test User",
    }),
    ...overrides,
  } as MatrixMonitorContext;
}

/**
 * Create a test message event.
 */
function createTestMessage(
  overrides: Partial<Parameters<MatrixMessageHandler>[0]> = {},
): Parameters<MatrixMessageHandler>[0] {
  return {
    eventId: "$test:matrix.org",
    roomId: "!room:matrix.org",
    sender: "@user:matrix.org",
    body: "Hello, bot!",
    msgtype: "m.text",
    timestamp: Date.now(),
    ...overrides,
  };
}

/**
 * Create test meta for message handler.
 */
function createTestMeta(
  overrides: Partial<Parameters<MatrixMessageHandler>[1]> = {},
): Parameters<MatrixMessageHandler>[1] {
  return {
    source: "timeline",
    wasMentioned: false,
    ...overrides,
  };
}

describe("Matrix message handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createMatrixMessageHandler", () => {
    it("returns a function", async () => {
      const { createMatrixMessageHandler } = await import("./message-handler/index.js");
      const ctx = createMockContext();
      const handler = createMatrixMessageHandler({ ctx });
      expect(typeof handler).toBe("function");
    });

    it("catches and logs errors from preflight", async () => {
      const { createMatrixMessageHandler } = await import("./message-handler/index.js");
      const errorFn = vi.fn();
      const ctx = createMockContext({
        runtime: { error: errorFn },
        // Force preflight to fail by making markMessageSeen throw
        markMessageSeen: vi.fn(() => {
          throw new Error("Test error");
        }),
      });

      const handler = createMatrixMessageHandler({ ctx });
      const message = createTestMessage();
      const meta = createTestMeta();

      await handler(message, meta);

      expect(errorFn).toHaveBeenCalled();
    });
  });

  describe("preflightMatrixMessage", () => {
    describe("bot self-message filtering", () => {
      it("returns null for bot's own messages", async () => {
        const { preflightMatrixMessage } = await import("./message-handler/preflight.js");
        const ctx = createMockContext({ botUserId: "@bot:matrix.org" });
        const message = createTestMessage({ sender: "@bot:matrix.org" });
        const meta = createTestMeta();

        const result = await preflightMatrixMessage({ ctx, message, meta });

        expect(result).toBeNull();
      });

      it("allows messages from other users", async () => {
        const { preflightMatrixMessage } = await import("./message-handler/preflight.js");
        const ctx = createMockContext({
          botUserId: "@bot:matrix.org",
          dmPolicy: "open",
          groupPolicy: "open",
        });
        ctx.resolveRoomInfo = vi.fn().mockResolvedValue({ isDirect: true });
        const message = createTestMessage({ sender: "@alice:matrix.org" });
        const meta = createTestMeta();

        const result = await preflightMatrixMessage({ ctx, message, meta });

        expect(result).not.toBeNull();
      });
    });

    describe("duplicate message detection", () => {
      it("returns null for duplicate messages", async () => {
        const { preflightMatrixMessage } = await import("./message-handler/preflight.js");
        const ctx = createMockContext({
          markMessageSeen: vi.fn(() => true), // Already seen
        });
        const message = createTestMessage();
        const meta = createTestMeta();

        const result = await preflightMatrixMessage({ ctx, message, meta });

        expect(result).toBeNull();
      });

      it("allows new messages", async () => {
        const { preflightMatrixMessage } = await import("./message-handler/preflight.js");
        const ctx = createMockContext({
          markMessageSeen: vi.fn(() => false), // New message
          dmPolicy: "open",
          groupPolicy: "open",
        });
        ctx.resolveRoomInfo = vi.fn().mockResolvedValue({ isDirect: true });
        const message = createTestMessage();
        const meta = createTestMeta();

        const result = await preflightMatrixMessage({ ctx, message, meta });

        expect(result).not.toBeNull();
      });
    });

    describe("DM policy checks", () => {
      it("returns null when DMs are disabled", async () => {
        const { preflightMatrixMessage } = await import("./message-handler/preflight.js");
        const ctx = createMockContext({
          dmEnabled: false,
        });
        ctx.resolveRoomInfo = vi.fn().mockResolvedValue({ isDirect: true });
        const message = createTestMessage();
        const meta = createTestMeta();

        const result = await preflightMatrixMessage({ ctx, message, meta });

        expect(result).toBeNull();
      });

      it("returns null when dmPolicy is disabled", async () => {
        const { preflightMatrixMessage } = await import("./message-handler/preflight.js");
        const ctx = createMockContext({
          dmEnabled: true,
          dmPolicy: "disabled",
        });
        ctx.resolveRoomInfo = vi.fn().mockResolvedValue({ isDirect: true });
        const message = createTestMessage();
        const meta = createTestMeta();

        const result = await preflightMatrixMessage({ ctx, message, meta });

        expect(result).toBeNull();
      });

      it("allows DMs with open policy", async () => {
        const { preflightMatrixMessage } = await import("./message-handler/preflight.js");
        const ctx = createMockContext({
          dmEnabled: true,
          dmPolicy: "open",
        });
        ctx.resolveRoomInfo = vi.fn().mockResolvedValue({ isDirect: true });
        const message = createTestMessage();
        const meta = createTestMeta();

        const result = await preflightMatrixMessage({ ctx, message, meta });

        expect(result).not.toBeNull();
        expect(result?.isDirect).toBe(true);
      });

      it("returns null for unauthorized DM sender with pairing policy", async () => {
        const { preflightMatrixMessage } = await import("./message-handler/preflight.js");
        const ctx = createMockContext({
          dmEnabled: true,
          dmPolicy: "pairing",
          allowFrom: ["@allowed:matrix.org"],
        });
        ctx.resolveRoomInfo = vi.fn().mockResolvedValue({ isDirect: true });
        const message = createTestMessage({ sender: "@stranger:matrix.org" });
        const meta = createTestMeta();

        const result = await preflightMatrixMessage({ ctx, message, meta });

        expect(result).toBeNull();
      });

      it("allows authorized DM sender with pairing policy", async () => {
        const { preflightMatrixMessage } = await import("./message-handler/preflight.js");
        // Mock the pairing store to include the sender
        const { readChannelAllowFromStore } = await import("../../pairing/pairing-store.js");
        vi.mocked(readChannelAllowFromStore).mockResolvedValue(["@allowed:matrix.org"]);

        const ctx = createMockContext({
          dmEnabled: true,
          dmPolicy: "pairing",
          allowFrom: ["@allowed:matrix.org"],
        });
        ctx.resolveRoomInfo = vi.fn().mockResolvedValue({ isDirect: true });
        const message = createTestMessage({ sender: "@allowed:matrix.org" });
        const meta = createTestMeta();

        const result = await preflightMatrixMessage({ ctx, message, meta });

        expect(result).not.toBeNull();
        expect(result?.isDirect).toBe(true);
      });
    });

    describe("room policy checks", () => {
      it("returns null when groupPolicy is disabled", async () => {
        const { preflightMatrixMessage } = await import("./message-handler/preflight.js");
        const ctx = createMockContext({
          groupPolicy: "disabled",
        });
        ctx.resolveRoomInfo = vi.fn().mockResolvedValue({ isDirect: false });
        const message = createTestMessage();
        const meta = createTestMeta();

        const result = await preflightMatrixMessage({ ctx, message, meta });

        expect(result).toBeNull();
      });

      it("returns null for room not in allowlist", async () => {
        const { preflightMatrixMessage } = await import("./message-handler/preflight.js");
        const ctx = createMockContext({
          groupPolicy: "allowlist",
          roomsConfig: {}, // Empty - room not in config
        });
        ctx.resolveRoomInfo = vi.fn().mockResolvedValue({ isDirect: false });
        const message = createTestMessage({ roomId: "!unknown:matrix.org" });
        const meta = createTestMeta();

        const result = await preflightMatrixMessage({ ctx, message, meta });

        expect(result).toBeNull();
      });

      it("allows room in allowlist", async () => {
        const { preflightMatrixMessage } = await import("./message-handler/preflight.js");
        const ctx = createMockContext({
          groupPolicy: "allowlist",
          roomsConfig: {
            "!room:matrix.org": { enabled: true },
          },
        });
        ctx.resolveRoomInfo = vi.fn().mockResolvedValue({
          isDirect: false,
          name: "Test Room",
        });
        const message = createTestMessage({ roomId: "!room:matrix.org" });
        const meta = createTestMeta({ wasMentioned: true });

        const result = await preflightMatrixMessage({ ctx, message, meta });

        expect(result).not.toBeNull();
        expect(result?.isDirect).toBe(false);
      });

      it("allows all rooms with open policy", async () => {
        const { preflightMatrixMessage } = await import("./message-handler/preflight.js");
        const ctx = createMockContext({
          groupPolicy: "open",
          roomsConfig: {},
        });
        ctx.resolveRoomInfo = vi.fn().mockResolvedValue({ isDirect: false });
        const message = createTestMessage();
        const meta = createTestMeta({ wasMentioned: true });

        const result = await preflightMatrixMessage({ ctx, message, meta });

        expect(result).not.toBeNull();
      });

      it("returns null for disabled room", async () => {
        const { preflightMatrixMessage } = await import("./message-handler/preflight.js");
        const ctx = createMockContext({
          groupPolicy: "allowlist",
          roomsConfig: {
            "!room:matrix.org": { enabled: false },
          },
        });
        ctx.resolveRoomInfo = vi.fn().mockResolvedValue({ isDirect: false });
        const message = createTestMessage({ roomId: "!room:matrix.org" });
        const meta = createTestMeta();

        const result = await preflightMatrixMessage({ ctx, message, meta });

        expect(result).toBeNull();
      });
    });

    describe("mention requirement", () => {
      it("returns null when mention required but not mentioned", async () => {
        const { preflightMatrixMessage } = await import("./message-handler/preflight.js");
        const ctx = createMockContext({
          groupPolicy: "allowlist",
          roomsConfig: {
            "!room:matrix.org": { enabled: true, requireMention: true },
          },
        });
        ctx.resolveRoomInfo = vi.fn().mockResolvedValue({ isDirect: false });
        const message = createTestMessage({ roomId: "!room:matrix.org" });
        const meta = createTestMeta({ wasMentioned: false });

        // Mock containsMatrixMention to return false
        const { containsMatrixMention } = await import("../format.js");
        vi.mocked(containsMatrixMention).mockReturnValue(false);

        const result = await preflightMatrixMessage({ ctx, message, meta });

        expect(result).toBeNull();
      });

      it("allows message when mention required and mentioned", async () => {
        const { preflightMatrixMessage } = await import("./message-handler/preflight.js");
        const ctx = createMockContext({
          groupPolicy: "allowlist",
          roomsConfig: {
            "!room:matrix.org": { enabled: true, requireMention: true },
          },
        });
        ctx.resolveRoomInfo = vi.fn().mockResolvedValue({ isDirect: false });
        const message = createTestMessage({ roomId: "!room:matrix.org" });
        const meta = createTestMeta({ wasMentioned: true });

        const result = await preflightMatrixMessage({ ctx, message, meta });

        expect(result).not.toBeNull();
        expect(result?.wasMentioned).toBe(true);
      });

      it("does not require mention for DMs", async () => {
        const { preflightMatrixMessage } = await import("./message-handler/preflight.js");
        const ctx = createMockContext({
          dmEnabled: true,
          dmPolicy: "open",
        });
        ctx.resolveRoomInfo = vi.fn().mockResolvedValue({ isDirect: true });
        const message = createTestMessage();
        const meta = createTestMeta({ wasMentioned: false });

        const result = await preflightMatrixMessage({ ctx, message, meta });

        expect(result).not.toBeNull();
      });
    });

    describe("empty message filtering", () => {
      it("returns null for empty body", async () => {
        const { preflightMatrixMessage } = await import("./message-handler/preflight.js");
        const ctx = createMockContext({
          dmEnabled: true,
          dmPolicy: "open",
        });
        ctx.resolveRoomInfo = vi.fn().mockResolvedValue({ isDirect: true });
        const message = createTestMessage({ body: "" });
        const meta = createTestMeta();

        const result = await preflightMatrixMessage({ ctx, message, meta });

        expect(result).toBeNull();
      });

      it("returns null for whitespace-only body", async () => {
        const { preflightMatrixMessage } = await import("./message-handler/preflight.js");
        const ctx = createMockContext({
          dmEnabled: true,
          dmPolicy: "open",
        });
        ctx.resolveRoomInfo = vi.fn().mockResolvedValue({ isDirect: true });
        const message = createTestMessage({ body: "   " });
        const meta = createTestMeta();

        const result = await preflightMatrixMessage({ ctx, message, meta });

        expect(result).toBeNull();
      });
    });

    describe("prepared context", () => {
      it("includes all required fields", async () => {
        const { preflightMatrixMessage } = await import("./message-handler/preflight.js");
        const ctx = createMockContext({
          dmEnabled: true,
          dmPolicy: "open",
        });
        ctx.resolveRoomInfo = vi.fn().mockResolvedValue({
          isDirect: true,
          name: "DM Room",
        });
        ctx.resolveUserDisplayName = vi.fn().mockResolvedValue({
          displayName: "Alice",
        });
        const message = createTestMessage({ sender: "@alice:matrix.org" });
        const meta = createTestMeta();

        const result = await preflightMatrixMessage({ ctx, message, meta });

        expect(result).not.toBeNull();
        expect(result?.ctx).toBe(ctx);
        expect(result?.message).toBe(message);
        expect(result?.meta).toBe(meta);
        expect(result?.isDirect).toBe(true);
        expect(result?.senderDisplayName).toBe("Alice");
        expect(result?.route).toBeDefined();
        expect(result?.wasMentioned).toBeDefined();
        expect(result?.commandAuthorized).toBeDefined();
      });
    });

    describe("room user allowlist", () => {
      it("returns null for user not in room users list", async () => {
        const { preflightMatrixMessage } = await import("./message-handler/preflight.js");
        const ctx = createMockContext({
          groupPolicy: "allowlist",
          roomsConfig: {
            "!room:matrix.org": {
              enabled: true,
              users: ["@admin:matrix.org"],
            },
          },
        });
        ctx.resolveRoomInfo = vi.fn().mockResolvedValue({ isDirect: false });
        const message = createTestMessage({
          roomId: "!room:matrix.org",
          sender: "@stranger:matrix.org",
        });
        const meta = createTestMeta({ wasMentioned: true });

        const result = await preflightMatrixMessage({ ctx, message, meta });

        expect(result).toBeNull();
      });

      it("allows user in room users list", async () => {
        const { preflightMatrixMessage } = await import("./message-handler/preflight.js");
        const ctx = createMockContext({
          groupPolicy: "allowlist",
          roomsConfig: {
            "!room:matrix.org": {
              enabled: true,
              users: ["@admin:matrix.org"],
            },
          },
        });
        ctx.resolveRoomInfo = vi.fn().mockResolvedValue({ isDirect: false });
        const message = createTestMessage({
          roomId: "!room:matrix.org",
          sender: "@admin:matrix.org",
        });
        const meta = createTestMeta({ wasMentioned: true });

        const result = await preflightMatrixMessage({ ctx, message, meta });

        expect(result).not.toBeNull();
      });
    });
  });

  describe("process helpers", () => {
    describe("buildSenderLabel (tested via process output)", () => {
      it("includes display name when available", async () => {
        const { preflightMatrixMessage } = await import("./message-handler/preflight.js");
        const ctx = createMockContext({
          dmEnabled: true,
          dmPolicy: "open",
        });
        ctx.resolveRoomInfo = vi.fn().mockResolvedValue({ isDirect: true });
        ctx.resolveUserDisplayName = vi.fn().mockResolvedValue({
          displayName: "Alice Smith",
        });
        const message = createTestMessage({ sender: "@alice:matrix.org" });
        const meta = createTestMeta();

        const result = await preflightMatrixMessage({ ctx, message, meta });

        expect(result?.senderDisplayName).toBe("Alice Smith");
      });

      it("handles missing display name", async () => {
        const { preflightMatrixMessage } = await import("./message-handler/preflight.js");
        const ctx = createMockContext({
          dmEnabled: true,
          dmPolicy: "open",
        });
        ctx.resolveRoomInfo = vi.fn().mockResolvedValue({ isDirect: true });
        ctx.resolveUserDisplayName = vi.fn().mockResolvedValue({});
        const message = createTestMessage({ sender: "@alice:matrix.org" });
        const meta = createTestMeta();

        const result = await preflightMatrixMessage({ ctx, message, meta });

        expect(result?.senderDisplayName).toBeUndefined();
      });
    });

    describe("buildRoomLabel (tested via resolveRoomInfo)", () => {
      it("returns room name when available", async () => {
        const { preflightMatrixMessage } = await import("./message-handler/preflight.js");
        const ctx = createMockContext({
          groupPolicy: "open",
        });
        ctx.resolveRoomInfo = vi.fn().mockResolvedValue({
          isDirect: false,
          name: "General Chat",
        });
        const message = createTestMessage();
        const meta = createTestMeta({ wasMentioned: true });

        const result = await preflightMatrixMessage({ ctx, message, meta });

        expect(result?.roomName).toBe("General Chat");
      });

      it("handles missing room name", async () => {
        const { preflightMatrixMessage } = await import("./message-handler/preflight.js");
        const ctx = createMockContext({
          groupPolicy: "open",
        });
        ctx.resolveRoomInfo = vi.fn().mockResolvedValue({
          isDirect: false,
        });
        const message = createTestMessage();
        const meta = createTestMeta({ wasMentioned: true });

        const result = await preflightMatrixMessage({ ctx, message, meta });

        expect(result?.roomName).toBeUndefined();
      });
    });
  });

  describe("history entry building", () => {
    it("builds history entry for room messages with history enabled", async () => {
      const { preflightMatrixMessage } = await import("./message-handler/preflight.js");
      const ctx = createMockContext({
        groupPolicy: "open",
        historyLimit: 10,
      });
      ctx.resolveRoomInfo = vi.fn().mockResolvedValue({ isDirect: false });
      ctx.resolveUserDisplayName = vi.fn().mockResolvedValue({
        displayName: "Alice",
      });
      const timestamp = Date.now();
      const message = createTestMessage({
        body: "Hello everyone!",
        timestamp,
      });
      const meta = createTestMeta({ wasMentioned: true });

      const result = await preflightMatrixMessage({ ctx, message, meta });

      expect(result?.historyEntry).toBeDefined();
      expect(result?.historyEntry?.sender).toBe("Alice");
      expect(result?.historyEntry?.body).toBe("Hello everyone!");
      expect(result?.historyEntry?.timestamp).toBe(timestamp);
      expect(result?.historyEntry?.messageId).toBe("$test:matrix.org");
    });

    it("does not build history entry for DMs", async () => {
      const { preflightMatrixMessage } = await import("./message-handler/preflight.js");
      const ctx = createMockContext({
        dmEnabled: true,
        dmPolicy: "open",
        historyLimit: 10,
      });
      ctx.resolveRoomInfo = vi.fn().mockResolvedValue({ isDirect: true });
      const message = createTestMessage();
      const meta = createTestMeta();

      const result = await preflightMatrixMessage({ ctx, message, meta });

      expect(result?.historyEntry).toBeUndefined();
    });

    it("does not build history entry when history disabled", async () => {
      const { preflightMatrixMessage } = await import("./message-handler/preflight.js");
      const ctx = createMockContext({
        groupPolicy: "open",
        historyLimit: 0,
      });
      ctx.resolveRoomInfo = vi.fn().mockResolvedValue({ isDirect: false });
      const message = createTestMessage();
      const meta = createTestMeta({ wasMentioned: true });

      const result = await preflightMatrixMessage({ ctx, message, meta });

      expect(result?.historyEntry).toBeUndefined();
    });

    it("uses sender ID when display name unavailable", async () => {
      const { preflightMatrixMessage } = await import("./message-handler/preflight.js");
      const ctx = createMockContext({
        groupPolicy: "open",
        historyLimit: 10,
      });
      ctx.resolveRoomInfo = vi.fn().mockResolvedValue({ isDirect: false });
      ctx.resolveUserDisplayName = vi.fn().mockResolvedValue({});
      const message = createTestMessage({ sender: "@bob:matrix.org" });
      const meta = createTestMeta({ wasMentioned: true });

      const result = await preflightMatrixMessage({ ctx, message, meta });

      expect(result?.historyEntry?.sender).toBe("@bob:matrix.org");
    });
  });

  describe("channel activity recording", () => {
    it("records inbound activity", async () => {
      const { preflightMatrixMessage } = await import("./message-handler/preflight.js");
      const { recordChannelActivity } = await import("../../infra/channel-activity.js");

      const ctx = createMockContext({
        dmEnabled: true,
        dmPolicy: "open",
        accountId: "my-account",
      });
      ctx.resolveRoomInfo = vi.fn().mockResolvedValue({ isDirect: true });
      const message = createTestMessage();
      const meta = createTestMeta();

      await preflightMatrixMessage({ ctx, message, meta });

      expect(recordChannelActivity).toHaveBeenCalledWith({
        channel: "matrix",
        accountId: "my-account",
        direction: "inbound",
      });
    });
  });

  describe("command authorization", () => {
    it("sets commandAuthorized true for open DM policy", async () => {
      const { preflightMatrixMessage } = await import("./message-handler/preflight.js");
      const ctx = createMockContext({
        dmEnabled: true,
        dmPolicy: "open",
      });
      ctx.resolveRoomInfo = vi.fn().mockResolvedValue({ isDirect: true });
      const message = createTestMessage();
      const meta = createTestMeta();

      const result = await preflightMatrixMessage({ ctx, message, meta });

      expect(result?.commandAuthorized).toBe(true);
    });

    it("sets commandAuthorized based on room user list", async () => {
      const { preflightMatrixMessage } = await import("./message-handler/preflight.js");
      const ctx = createMockContext({
        groupPolicy: "allowlist",
        roomsConfig: {
          "!room:matrix.org": {
            enabled: true,
            users: ["@admin:matrix.org"],
          },
        },
      });
      ctx.resolveRoomInfo = vi.fn().mockResolvedValue({ isDirect: false });
      const message = createTestMessage({
        roomId: "!room:matrix.org",
        sender: "@admin:matrix.org",
      });
      const meta = createTestMeta({ wasMentioned: true });

      const result = await preflightMatrixMessage({ ctx, message, meta });

      expect(result?.commandAuthorized).toBe(true);
    });
  });

  describe("reply context", () => {
    it("preserves replyTo from message", async () => {
      const { preflightMatrixMessage } = await import("./message-handler/preflight.js");
      const ctx = createMockContext({
        dmEnabled: true,
        dmPolicy: "open",
      });
      ctx.resolveRoomInfo = vi.fn().mockResolvedValue({ isDirect: true });
      const message = createTestMessage({
        replyTo: "$original:matrix.org",
      });
      const meta = createTestMeta();

      const result = await preflightMatrixMessage({ ctx, message, meta });

      expect(result?.message.replyTo).toBe("$original:matrix.org");
    });
  });

  describe("agent route resolution", () => {
    it("resolves route with correct channel info", async () => {
      const { preflightMatrixMessage } = await import("./message-handler/preflight.js");
      const { resolveAgentRoute } = await import("../../routing/resolve-route.js");

      const ctx = createMockContext({
        dmEnabled: true,
        dmPolicy: "open",
        accountId: "test-account",
      });
      ctx.resolveRoomInfo = vi.fn().mockResolvedValue({ isDirect: true });
      const message = createTestMessage({
        sender: "@alice:matrix.org",
        roomId: "!dmroom:matrix.org",
      });
      const meta = createTestMeta();

      await preflightMatrixMessage({ ctx, message, meta });

      expect(resolveAgentRoute).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "matrix",
          accountId: "test-account",
          peer: {
            kind: "dm",
            id: "@alice:matrix.org",
          },
        }),
      );
    });

    it("resolves route for room messages", async () => {
      const { preflightMatrixMessage } = await import("./message-handler/preflight.js");
      const { resolveAgentRoute } = await import("../../routing/resolve-route.js");

      const ctx = createMockContext({
        groupPolicy: "open",
        accountId: "test-account",
      });
      ctx.resolveRoomInfo = vi.fn().mockResolvedValue({ isDirect: false });
      const message = createTestMessage({
        roomId: "!general:matrix.org",
      });
      const meta = createTestMeta({ wasMentioned: true });

      await preflightMatrixMessage({ ctx, message, meta });

      expect(resolveAgentRoute).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "matrix",
          peer: {
            kind: "channel",
            id: "!general:matrix.org",
          },
        }),
      );
    });
  });
});
