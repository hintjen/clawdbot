/**
 * Integration tests for Matrix monitor provider.
 *
 * Tests the monitorMatrixProvider() entry point with mocked Matrix client.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

// Mock external dependencies before imports
vi.mock("../globals.js", () => ({
  logVerbose: vi.fn(),
  shouldLogVerbose: vi.fn(() => false),
  danger: vi.fn((msg: string) => msg),
}));

vi.mock("../config/config.js", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("../infra/channel-activity.js", () => ({
  recordChannelActivity: vi.fn(),
}));

vi.mock("../pairing/pairing-store.js", () => ({
  readChannelAllowFromStore: vi.fn().mockResolvedValue([]),
  upsertChannelPairingRequest: vi.fn().mockResolvedValue({ code: "ABC123", created: true }),
}));

vi.mock("../pairing/pairing-messages.js", () => ({
  buildPairingReply: vi.fn(() => "Please pair with code: ABC123"),
}));

vi.mock("../routing/resolve-route.js", () => ({
  resolveAgentRoute: vi.fn(() => ({
    sessionKey: "test-session-key",
    accountId: "test-account",
    agentId: "test-agent",
  })),
}));

vi.mock("../auto-reply/reply/mentions.js", () => ({
  buildMentionRegexes: vi.fn(() => []),
  matchesMentionPatterns: vi.fn(() => false),
}));

// Import after mocks are set up
import type { MatrixClient, ClientEvent as ClientEventType } from "matrix-js-sdk";
import type { ClawdbotConfig } from "../config/config.js";
import * as configModule from "../config/config.js";
import * as clientModule from "./client.js";

/**
 * Create a minimal mock Matrix client for testing.
 */
function createMockMatrixClient(): MatrixClient {
  const eventHandlers = new Map<string, Set<(...args: any[]) => void>>();

  return {
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      if (!eventHandlers.has(event)) {
        eventHandlers.set(event, new Set());
      }
      eventHandlers.get(event)!.add(handler);
      return this;
    }),
    off: vi.fn((event: string, handler: (...args: any[]) => void) => {
      eventHandlers.get(event)?.delete(handler);
      return this;
    }),
    removeListener: vi.fn((event: string, handler: (...args: any[]) => void) => {
      eventHandlers.get(event)?.delete(handler);
      return this;
    }),
    emit: (event: string, ...args: any[]) => {
      eventHandlers.get(event)?.forEach((handler) => handler(...args));
    },
    startClient: vi.fn(),
    stopClient: vi.fn(),
    getSyncState: vi.fn(() => "PREPARED"),
    whoami: vi.fn().mockResolvedValue({ user_id: "@bot:matrix.org", device_id: "DEVICE123" }),
    sendTyping: vi.fn().mockResolvedValue(undefined),
    sendEvent: vi.fn().mockResolvedValue({ event_id: "$mock-event-id" }),
    getRoom: vi.fn().mockReturnValue(null),
    getUserId: vi.fn(() => "@bot:matrix.org"),
    getHomeserverUrl: vi.fn(() => "https://matrix.org"),
  } as unknown as MatrixClient;
}

/**
 * Create a minimal config for testing.
 */
function createTestConfig(overrides: Partial<ClawdbotConfig> = {}): ClawdbotConfig {
  return {
    channels: {
      matrix: {
        homeserver: "https://matrix.org",
        userId: "@bot:matrix.org",
        accessToken: "test-access-token",
        enabled: true,
        groupPolicy: "open",
        dm: {
          enabled: true,
          policy: "open",
        },
      },
    },
    ...overrides,
  } as ClawdbotConfig;
}

describe("monitorMatrixProvider", () => {
  let mockClient: MatrixClient & { emit: (event: string, ...args: any[]) => void };
  let loadConfigSpy: MockInstance;
  let createMatrixClientSpy: MockInstance;
  let loginMatrixSpy: MockInstance;
  let startMatrixSyncSpy: MockInstance;
  let waitForMatrixClientStopSpy: MockInstance;

  beforeEach(() => {
    mockClient = createMockMatrixClient() as MatrixClient & {
      emit: (event: string, ...args: any[]) => void;
    };

    loadConfigSpy = vi.spyOn(configModule, "loadConfig").mockReturnValue(createTestConfig());

    createMatrixClientSpy = vi
      .spyOn(clientModule, "createMatrixClient")
      .mockReturnValue(mockClient);

    loginMatrixSpy = vi.spyOn(clientModule, "loginMatrix").mockResolvedValue({
      userId: "@bot:matrix.org",
      deviceId: "DEVICE123",
      accessToken: "test-access-token",
    });

    startMatrixSyncSpy = vi
      .spyOn(clientModule, "startMatrixSync")
      .mockResolvedValue(undefined);

    waitForMatrixClientStopSpy = vi
      .spyOn(clientModule, "waitForMatrixClientStop")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("startup and initialization", () => {
    it("creates Matrix client with correct options", async () => {
      const { monitorMatrixProvider } = await import("./monitor/provider.js");
      await monitorMatrixProvider();

      expect(createMatrixClientSpy).toHaveBeenCalledWith({
        homeserver: "https://matrix.org",
        userId: "@bot:matrix.org",
        accessToken: "test-access-token",
        deviceId: undefined,
      });
    });

    it("logs in with access token", async () => {
      const { monitorMatrixProvider } = await import("./monitor/provider.js");
      await monitorMatrixProvider();

      expect(loginMatrixSpy).toHaveBeenCalledWith(
        mockClient,
        expect.objectContaining({
          userId: "@bot:matrix.org",
          accessToken: "test-access-token",
        }),
      );
    });

    it("logs in with password when accessToken not provided", async () => {
      loadConfigSpy.mockReturnValue(
        createTestConfig({
          channels: {
            matrix: {
              homeserver: "https://matrix.org",
              userId: "@bot:matrix.org",
              password: "secret-password",
              enabled: true,
            },
          },
        }),
      );

      const { monitorMatrixProvider } = await import("./monitor/provider.js");
      await monitorMatrixProvider();

      expect(loginMatrixSpy).toHaveBeenCalledWith(
        mockClient,
        expect.objectContaining({
          userId: "@bot:matrix.org",
          password: "secret-password",
        }),
      );
    });

    it("starts sync loop after login", async () => {
      const { monitorMatrixProvider } = await import("./monitor/provider.js");
      await monitorMatrixProvider();

      expect(startMatrixSyncSpy).toHaveBeenCalledWith(
        mockClient,
        expect.objectContaining({ runtime: expect.anything() }),
      );
    });

    it("waits for client stop/abort", async () => {
      const { monitorMatrixProvider } = await import("./monitor/provider.js");
      await monitorMatrixProvider();

      expect(waitForMatrixClientStopSpy).toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("throws error when account is disabled", async () => {
      loadConfigSpy.mockReturnValue(
        createTestConfig({
          channels: {
            matrix: {
              homeserver: "https://matrix.org",
              userId: "@bot:matrix.org",
              accessToken: "test-token",
              enabled: false,
            },
          },
        }),
      );

      const { monitorMatrixProvider } = await import("./monitor/provider.js");
      await expect(monitorMatrixProvider()).rejects.toThrow(
        'Matrix account "default" is disabled',
      );
    });

    it("throws error when homeserver is missing", async () => {
      loadConfigSpy.mockReturnValue(
        createTestConfig({
          channels: {
            matrix: {
              userId: "@bot:matrix.org",
              accessToken: "test-token",
              enabled: true,
            },
          },
        }),
      );

      const { monitorMatrixProvider } = await import("./monitor/provider.js");
      await expect(monitorMatrixProvider()).rejects.toThrow(
        /Matrix homeserver URL missing/,
      );
    });

    it("throws error when userId is missing", async () => {
      loadConfigSpy.mockReturnValue(
        createTestConfig({
          channels: {
            matrix: {
              homeserver: "https://matrix.org",
              accessToken: "test-token",
              enabled: true,
            },
          },
        }),
      );

      const { monitorMatrixProvider } = await import("./monitor/provider.js");
      await expect(monitorMatrixProvider()).rejects.toThrow(/Matrix userId missing/);
    });

    it("throws error when credentials are missing", async () => {
      loadConfigSpy.mockReturnValue(
        createTestConfig({
          channels: {
            matrix: {
              homeserver: "https://matrix.org",
              userId: "@bot:matrix.org",
              enabled: true,
            },
          },
        }),
      );

      const { monitorMatrixProvider } = await import("./monitor/provider.js");
      await expect(monitorMatrixProvider()).rejects.toThrow(
        /Matrix credentials missing/,
      );
    });

    it("throws error when login fails", async () => {
      loginMatrixSpy.mockRejectedValue(new Error("Invalid token"));

      const { monitorMatrixProvider } = await import("./monitor/provider.js");
      await expect(monitorMatrixProvider()).rejects.toThrow("Invalid token");
    });

    it("throws error when sync fails to start", async () => {
      startMatrixSyncSpy.mockRejectedValue(new Error("Sync timeout"));

      const { monitorMatrixProvider } = await import("./monitor/provider.js");
      await expect(monitorMatrixProvider()).rejects.toThrow("Sync timeout");
    });
  });

  describe("configuration options", () => {
    it("uses provided accountId", async () => {
      loadConfigSpy.mockReturnValue({
        channels: {
          matrix: {
            homeserver: "https://default.org",
            userId: "@default:default.org",
            accessToken: "default-token",
            enabled: true,
            accounts: {
              secondary: {
                homeserver: "https://secondary.org",
                userId: "@bot:secondary.org",
                accessToken: "secondary-token",
                enabled: true,
              },
            },
          },
        },
      } as ClawdbotConfig);

      const { monitorMatrixProvider } = await import("./monitor/provider.js");
      await monitorMatrixProvider({ accountId: "secondary" });

      expect(createMatrixClientSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          homeserver: "https://secondary.org",
          userId: "@bot:secondary.org",
          accessToken: "secondary-token",
        }),
      );
    });

    it("uses provided config instead of loadConfig", async () => {
      // Reset the spy call count for this specific test
      loadConfigSpy.mockClear();

      const customConfig = createTestConfig({
        channels: {
          matrix: {
            homeserver: "https://custom.org",
            userId: "@custom:custom.org",
            accessToken: "custom-token",
            enabled: true,
          },
        },
      });

      const { monitorMatrixProvider } = await import("./monitor/provider.js");
      await monitorMatrixProvider({ config: customConfig });

      // When config is provided, loadConfig should not be called for this invocation
      // Note: We verify the custom config was used by checking client creation
      expect(createMatrixClientSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          homeserver: "https://custom.org",
          userId: "@custom:custom.org",
        }),
      );
    });

    it("uses provided accessToken override", async () => {
      const { monitorMatrixProvider } = await import("./monitor/provider.js");
      await monitorMatrixProvider({ accessToken: "override-token" });

      expect(loginMatrixSpy).toHaveBeenCalledWith(
        mockClient,
        expect.objectContaining({
          accessToken: "override-token",
        }),
      );
    });

    it("uses provided password override", async () => {
      loadConfigSpy.mockReturnValue(
        createTestConfig({
          channels: {
            matrix: {
              homeserver: "https://matrix.org",
              userId: "@bot:matrix.org",
              password: "config-password",
              enabled: true,
            },
          },
        }),
      );

      const { monitorMatrixProvider } = await import("./monitor/provider.js");
      await monitorMatrixProvider({ password: "override-password" });

      expect(loginMatrixSpy).toHaveBeenCalledWith(
        mockClient,
        expect.objectContaining({
          password: "override-password",
        }),
      );
    });

    it("uses provided abortSignal", async () => {
      const abortController = new AbortController();

      const { monitorMatrixProvider } = await import("./monitor/provider.js");
      await monitorMatrixProvider({ abortSignal: abortController.signal });

      expect(waitForMatrixClientStopSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          abortSignal: abortController.signal,
        }),
      );
    });

    it("uses custom runtime", async () => {
      const customRuntime = {
        log: vi.fn(),
        error: vi.fn(),
        exit: vi.fn(),
      };

      const { monitorMatrixProvider } = await import("./monitor/provider.js");
      await monitorMatrixProvider({ runtime: customRuntime });

      expect(customRuntime.log).toHaveBeenCalledWith(
        expect.stringContaining("logged in to matrix as"),
      );
    });
  });

  describe("event handler registration", () => {
    it("registers Room.timeline event handler", async () => {
      const { monitorMatrixProvider } = await import("./monitor/provider.js");
      await monitorMatrixProvider();

      expect(mockClient.on).toHaveBeenCalledWith(
        "Room.timeline",
        expect.any(Function),
      );
    });

    it("registers RoomMemberEvent.Membership handler", async () => {
      const { monitorMatrixProvider } = await import("./monitor/provider.js");
      await monitorMatrixProvider();

      expect(mockClient.on).toHaveBeenCalledWith(
        "RoomMember.membership",
        expect.any(Function),
      );
    });

    it("registers RoomMemberEvent.Typing handler", async () => {
      const { monitorMatrixProvider } = await import("./monitor/provider.js");
      await monitorMatrixProvider();

      expect(mockClient.on).toHaveBeenCalledWith(
        "RoomMember.typing",
        expect.any(Function),
      );
    });

    it("registers RoomStateEvent.Events handler", async () => {
      const { monitorMatrixProvider } = await import("./monitor/provider.js");
      await monitorMatrixProvider();

      expect(mockClient.on).toHaveBeenCalledWith(
        "RoomState.events",
        expect.any(Function),
      );
    });
  });

  describe("policy configuration", () => {
    it("respects disabled DM policy", async () => {
      loadConfigSpy.mockReturnValue(
        createTestConfig({
          channels: {
            matrix: {
              homeserver: "https://matrix.org",
              userId: "@bot:matrix.org",
              accessToken: "test-token",
              enabled: true,
              dm: {
                enabled: false,
              },
            },
          },
        }),
      );

      const { monitorMatrixProvider } = await import("./monitor/provider.js");
      // Should start without error - DM disabled just means DMs are ignored
      await monitorMatrixProvider();

      expect(createMatrixClientSpy).toHaveBeenCalled();
    });

    it("respects allowlist group policy", async () => {
      loadConfigSpy.mockReturnValue(
        createTestConfig({
          channels: {
            matrix: {
              homeserver: "https://matrix.org",
              userId: "@bot:matrix.org",
              accessToken: "test-token",
              enabled: true,
              groupPolicy: "allowlist",
              rooms: {
                "!allowed:matrix.org": { enabled: true },
              },
            },
          },
        }),
      );

      const { monitorMatrixProvider } = await import("./monitor/provider.js");
      // Should start without error
      await monitorMatrixProvider();

      expect(createMatrixClientSpy).toHaveBeenCalled();
    });

    it("respects disabled group policy", async () => {
      loadConfigSpy.mockReturnValue(
        createTestConfig({
          channels: {
            matrix: {
              homeserver: "https://matrix.org",
              userId: "@bot:matrix.org",
              accessToken: "test-token",
              enabled: true,
              groupPolicy: "disabled",
            },
          },
        }),
      );

      const { monitorMatrixProvider } = await import("./monitor/provider.js");
      // Should start without error - disabled policy means room messages are ignored
      await monitorMatrixProvider();

      expect(createMatrixClientSpy).toHaveBeenCalled();
    });
  });
});

describe("provider lifecycle", () => {
  let mockClient: MatrixClient & { emit: (event: string, ...args: any[]) => void };
  let loadConfigSpy: MockInstance;
  let createMatrixClientSpy: MockInstance;
  let loginMatrixSpy: MockInstance;
  let startMatrixSyncSpy: MockInstance;
  let waitForMatrixClientStopSpy: MockInstance;

  beforeEach(() => {
    mockClient = createMockMatrixClient() as MatrixClient & {
      emit: (event: string, ...args: any[]) => void;
    };

    loadConfigSpy = vi.spyOn(configModule, "loadConfig").mockReturnValue(createTestConfig());

    createMatrixClientSpy = vi
      .spyOn(clientModule, "createMatrixClient")
      .mockReturnValue(mockClient);

    loginMatrixSpy = vi.spyOn(clientModule, "loginMatrix").mockResolvedValue({
      userId: "@bot:matrix.org",
      deviceId: "DEVICE123",
      accessToken: "test-access-token",
    });

    startMatrixSyncSpy = vi
      .spyOn(clientModule, "startMatrixSync")
      .mockResolvedValue(undefined);

    waitForMatrixClientStopSpy = vi
      .spyOn(clientModule, "waitForMatrixClientStop")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("completes when abort signal is triggered", async () => {
    const abortController = new AbortController();

    // Make waitForMatrixClientStop resolve when abort is called
    waitForMatrixClientStopSpy.mockImplementation(async (params: { abortSignal?: AbortSignal }) => {
      if (params.abortSignal) {
        await new Promise<void>((resolve) => {
          if (params.abortSignal!.aborted) {
            resolve();
          } else {
            params.abortSignal!.addEventListener("abort", () => resolve(), { once: true });
          }
        });
      }
    });

    const { monitorMatrixProvider } = await import("./monitor/provider.js");
    const monitorPromise = monitorMatrixProvider({ abortSignal: abortController.signal });

    // Give the provider time to start
    await new Promise((r) => setTimeout(r, 10));

    // Abort the provider
    abortController.abort();

    // Should complete without error
    await expect(monitorPromise).resolves.toBeUndefined();
  });

  it("logs successful login message", async () => {
    const customRuntime = {
      log: vi.fn(),
      error: vi.fn(),
    };

    const { monitorMatrixProvider } = await import("./monitor/provider.js");
    await monitorMatrixProvider({ runtime: customRuntime });

    expect(customRuntime.log).toHaveBeenCalledWith(
      "logged in to matrix as @bot:matrix.org on https://matrix.org",
    );
  });

  it("logs sync started message", async () => {
    const customRuntime = {
      log: vi.fn(),
      error: vi.fn(),
    };

    const { monitorMatrixProvider } = await import("./monitor/provider.js");
    await monitorMatrixProvider({ runtime: customRuntime });

    expect(customRuntime.log).toHaveBeenCalledWith("matrix sync started");
  });
});
