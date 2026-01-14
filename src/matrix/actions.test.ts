import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

import * as clientModule from "./client.js";
import * as configModule from "../config/config.js";
import type { ClawdbotConfig } from "../config/config.js";
import type { MatrixClient } from "matrix-js-sdk";
import { EventType, MsgType, RelationType } from "matrix-js-sdk";

/**
 * Create a minimal mock Matrix client for testing.
 */
function createMockClient(overrides: Partial<MatrixClient> = {}): MatrixClient {
  return {
    sendEvent: vi.fn().mockResolvedValue({ event_id: "$mock-event-id" }),
    redactEvent: vi.fn().mockResolvedValue({}),
    relations: vi.fn().mockResolvedValue({ events: [] }),
    whoami: vi.fn().mockResolvedValue({ user_id: "@bot:matrix.org" }),
    createMessagesRequest: vi.fn().mockResolvedValue({ chunk: [] }),
    getRoom: vi.fn().mockReturnValue(null),
    joinRoom: vi.fn().mockResolvedValue({ roomId: "!joined:matrix.org" }),
    leave: vi.fn().mockResolvedValue({}),
    invite: vi.fn().mockResolvedValue({}),
    getProfileInfo: vi.fn().mockResolvedValue({}),
    sendReadReceipt: vi.fn().mockResolvedValue({}),
    ...overrides,
  } as unknown as MatrixClient;
}

/**
 * Create a mock event for testing reactions.
 */
function createMockEvent(opts: {
  eventId: string;
  sender: string;
  relatesTo?: { key?: string };
}) {
  return {
    getId: () => opts.eventId,
    getSender: () => opts.sender,
    getContent: () =>
      opts.relatesTo ? { "m.relates_to": opts.relatesTo } : {},
  };
}

describe("normalizeEmoji", () => {
  // We test normalizeEmoji by testing reactMatrixMessage behavior
  // since normalizeEmoji is not exported

  let mockClient: MatrixClient;
  let loadConfigSpy: MockInstance;
  let createMatrixClientSpy: MockInstance;
  let loginMatrixSpy: MockInstance;
  let stopMatrixClientSpy: MockInstance;

  beforeEach(() => {
    mockClient = createMockClient();

    loadConfigSpy = vi.spyOn(configModule, "loadConfig").mockReturnValue({
      channels: {
        matrix: {
          homeserver: "https://matrix.org",
          userId: "@bot:matrix.org",
          accessToken: "test-token",
        },
      },
    } as ClawdbotConfig);

    createMatrixClientSpy = vi
      .spyOn(clientModule, "createMatrixClient")
      .mockReturnValue(mockClient);

    loginMatrixSpy = vi
      .spyOn(clientModule, "loginMatrix")
      .mockResolvedValue({} as any);

    stopMatrixClientSpy = vi
      .spyOn(clientModule, "stopMatrixClient")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts unicode emoji", async () => {
    const { reactMatrixMessage } = await import("./actions.js");
    await reactMatrixMessage("!room:test", "$event:test", "👍");

    expect(mockClient.sendEvent).toHaveBeenCalledWith(
      "!room:test",
      EventType.Reaction,
      expect.objectContaining({
        "m.relates_to": expect.objectContaining({
          key: "👍",
        }),
      }),
    );
  });

  it("strips colon wrappers from shortcodes", async () => {
    const { reactMatrixMessage } = await import("./actions.js");
    await reactMatrixMessage("!room:test", "$event:test", ":thumbsup:");

    expect(mockClient.sendEvent).toHaveBeenCalledWith(
      "!room:test",
      EventType.Reaction,
      expect.objectContaining({
        "m.relates_to": expect.objectContaining({
          key: "thumbsup",
        }),
      }),
    );
  });

  it("strips multiple colons from shortcodes", async () => {
    const { reactMatrixMessage } = await import("./actions.js");
    await reactMatrixMessage("!room:test", "$event:test", "::fire::");

    expect(mockClient.sendEvent).toHaveBeenCalledWith(
      "!room:test",
      EventType.Reaction,
      expect.objectContaining({
        "m.relates_to": expect.objectContaining({
          key: "fire",
        }),
      }),
    );
  });

  it("trims whitespace from emoji", async () => {
    const { reactMatrixMessage } = await import("./actions.js");
    await reactMatrixMessage("!room:test", "$event:test", "  🎉  ");

    expect(mockClient.sendEvent).toHaveBeenCalledWith(
      "!room:test",
      EventType.Reaction,
      expect.objectContaining({
        "m.relates_to": expect.objectContaining({
          key: "🎉",
        }),
      }),
    );
  });

  it("throws error for empty emoji", async () => {
    const { reactMatrixMessage } = await import("./actions.js");
    await expect(
      reactMatrixMessage("!room:test", "$event:test", ""),
    ).rejects.toThrow("Emoji is required for Matrix reactions");
  });

  it("throws error for whitespace-only emoji", async () => {
    const { reactMatrixMessage } = await import("./actions.js");
    await expect(
      reactMatrixMessage("!room:test", "$event:test", "   "),
    ).rejects.toThrow("Emoji is required for Matrix reactions");
  });
});

describe("reactMatrixMessage", () => {
  let mockClient: MatrixClient;
  let loadConfigSpy: MockInstance;
  let createMatrixClientSpy: MockInstance;
  let loginMatrixSpy: MockInstance;
  let stopMatrixClientSpy: MockInstance;

  beforeEach(() => {
    mockClient = createMockClient();

    loadConfigSpy = vi.spyOn(configModule, "loadConfig").mockReturnValue({
      channels: {
        matrix: {
          homeserver: "https://matrix.org",
          userId: "@bot:matrix.org",
          accessToken: "test-token",
        },
      },
    } as ClawdbotConfig);

    createMatrixClientSpy = vi
      .spyOn(clientModule, "createMatrixClient")
      .mockReturnValue(mockClient);

    loginMatrixSpy = vi
      .spyOn(clientModule, "loginMatrix")
      .mockResolvedValue({} as any);

    stopMatrixClientSpy = vi
      .spyOn(clientModule, "stopMatrixClient")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends reaction event with correct structure", async () => {
    const { reactMatrixMessage } = await import("./actions.js");
    await reactMatrixMessage("!room:matrix.org", "$event123", "👍");

    expect(mockClient.sendEvent).toHaveBeenCalledWith(
      "!room:matrix.org",
      EventType.Reaction,
      {
        "m.relates_to": {
          rel_type: RelationType.Annotation,
          event_id: "$event123",
          key: "👍",
        },
      },
    );
  });

  it("reuses provided client without creating new one", async () => {
    const providedClient = createMockClient();
    const { reactMatrixMessage } = await import("./actions.js");
    await reactMatrixMessage("!room:test", "$event:test", "👍", {
      client: providedClient,
    });

    expect(createMatrixClientSpy).not.toHaveBeenCalled();
    expect(loginMatrixSpy).not.toHaveBeenCalled();
    expect(stopMatrixClientSpy).not.toHaveBeenCalled();
    expect(providedClient.sendEvent).toHaveBeenCalled();
  });

  it("stops client after action when client was created", async () => {
    const { reactMatrixMessage } = await import("./actions.js");
    await reactMatrixMessage("!room:test", "$event:test", "👍");

    expect(stopMatrixClientSpy).toHaveBeenCalledWith(mockClient);
  });
});

describe("removeMatrixReaction", () => {
  let mockClient: MatrixClient;
  let loadConfigSpy: MockInstance;
  let createMatrixClientSpy: MockInstance;
  let loginMatrixSpy: MockInstance;
  let stopMatrixClientSpy: MockInstance;

  beforeEach(() => {
    mockClient = createMockClient();

    loadConfigSpy = vi.spyOn(configModule, "loadConfig").mockReturnValue({
      channels: {
        matrix: {
          homeserver: "https://matrix.org",
          userId: "@bot:matrix.org",
          accessToken: "test-token",
        },
      },
    } as ClawdbotConfig);

    createMatrixClientSpy = vi
      .spyOn(clientModule, "createMatrixClient")
      .mockReturnValue(mockClient);

    loginMatrixSpy = vi
      .spyOn(clientModule, "loginMatrix")
      .mockResolvedValue({} as any);

    stopMatrixClientSpy = vi
      .spyOn(clientModule, "stopMatrixClient")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does nothing when no reactions found", async () => {
    (mockClient.relations as any).mockResolvedValue({ events: [] });

    const { removeMatrixReaction } = await import("./actions.js");
    await removeMatrixReaction("!room:test", "$event:test", "👍");

    expect(mockClient.redactEvent).not.toHaveBeenCalled();
  });

  it("redacts own reaction with matching emoji", async () => {
    const mockEvent = createMockEvent({
      eventId: "$reaction:test",
      sender: "@bot:matrix.org",
      relatesTo: { key: "👍" },
    });
    (mockClient.relations as any).mockResolvedValue({ events: [mockEvent] });

    const { removeMatrixReaction } = await import("./actions.js");
    await removeMatrixReaction("!room:test", "$event:test", "👍");

    expect(mockClient.redactEvent).toHaveBeenCalledWith(
      "!room:test",
      "$reaction:test",
    );
  });

  it("does not redact reaction from other users", async () => {
    const mockEvent = createMockEvent({
      eventId: "$reaction:test",
      sender: "@other:matrix.org",
      relatesTo: { key: "👍" },
    });
    (mockClient.relations as any).mockResolvedValue({ events: [mockEvent] });

    const { removeMatrixReaction } = await import("./actions.js");
    await removeMatrixReaction("!room:test", "$event:test", "👍");

    expect(mockClient.redactEvent).not.toHaveBeenCalled();
  });

  it("does not redact own reaction with different emoji", async () => {
    const mockEvent = createMockEvent({
      eventId: "$reaction:test",
      sender: "@bot:matrix.org",
      relatesTo: { key: "👎" },
    });
    (mockClient.relations as any).mockResolvedValue({ events: [mockEvent] });

    const { removeMatrixReaction } = await import("./actions.js");
    await removeMatrixReaction("!room:test", "$event:test", "👍");

    expect(mockClient.redactEvent).not.toHaveBeenCalled();
  });
});

describe("removeOwnMatrixReactions", () => {
  let mockClient: MatrixClient;
  let loadConfigSpy: MockInstance;
  let createMatrixClientSpy: MockInstance;
  let loginMatrixSpy: MockInstance;
  let stopMatrixClientSpy: MockInstance;

  beforeEach(() => {
    mockClient = createMockClient();

    loadConfigSpy = vi.spyOn(configModule, "loadConfig").mockReturnValue({
      channels: {
        matrix: {
          homeserver: "https://matrix.org",
          userId: "@bot:matrix.org",
          accessToken: "test-token",
        },
      },
    } as ClawdbotConfig);

    createMatrixClientSpy = vi
      .spyOn(clientModule, "createMatrixClient")
      .mockReturnValue(mockClient);

    loginMatrixSpy = vi
      .spyOn(clientModule, "loginMatrix")
      .mockResolvedValue({} as any);

    stopMatrixClientSpy = vi
      .spyOn(clientModule, "stopMatrixClient")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty array when no reactions found", async () => {
    (mockClient.relations as any).mockResolvedValue({ events: [] });

    const { removeOwnMatrixReactions } = await import("./actions.js");
    const result = await removeOwnMatrixReactions("!room:test", "$event:test");

    expect(result).toEqual([]);
    expect(mockClient.redactEvent).not.toHaveBeenCalled();
  });

  it("removes all own reactions and returns their keys", async () => {
    const events = [
      createMockEvent({
        eventId: "$r1:test",
        sender: "@bot:matrix.org",
        relatesTo: { key: "👍" },
      }),
      createMockEvent({
        eventId: "$r2:test",
        sender: "@bot:matrix.org",
        relatesTo: { key: "🎉" },
      }),
    ];
    (mockClient.relations as any).mockResolvedValue({ events });

    const { removeOwnMatrixReactions } = await import("./actions.js");
    const result = await removeOwnMatrixReactions("!room:test", "$event:test");

    expect(result).toEqual(["👍", "🎉"]);
    expect(mockClient.redactEvent).toHaveBeenCalledTimes(2);
    expect(mockClient.redactEvent).toHaveBeenCalledWith("!room:test", "$r1:test");
    expect(mockClient.redactEvent).toHaveBeenCalledWith("!room:test", "$r2:test");
  });

  it("only removes own reactions, ignoring others", async () => {
    const events = [
      createMockEvent({
        eventId: "$r1:test",
        sender: "@bot:matrix.org",
        relatesTo: { key: "👍" },
      }),
      createMockEvent({
        eventId: "$r2:test",
        sender: "@other:matrix.org",
        relatesTo: { key: "🎉" },
      }),
    ];
    (mockClient.relations as any).mockResolvedValue({ events });

    const { removeOwnMatrixReactions } = await import("./actions.js");
    const result = await removeOwnMatrixReactions("!room:test", "$event:test");

    expect(result).toEqual(["👍"]);
    expect(mockClient.redactEvent).toHaveBeenCalledTimes(1);
    expect(mockClient.redactEvent).toHaveBeenCalledWith("!room:test", "$r1:test");
  });
});

describe("listMatrixReactions", () => {
  let mockClient: MatrixClient;
  let loadConfigSpy: MockInstance;
  let createMatrixClientSpy: MockInstance;
  let loginMatrixSpy: MockInstance;
  let stopMatrixClientSpy: MockInstance;

  beforeEach(() => {
    mockClient = createMockClient();

    loadConfigSpy = vi.spyOn(configModule, "loadConfig").mockReturnValue({
      channels: {
        matrix: {
          homeserver: "https://matrix.org",
          userId: "@bot:matrix.org",
          accessToken: "test-token",
        },
      },
    } as ClawdbotConfig);

    createMatrixClientSpy = vi
      .spyOn(clientModule, "createMatrixClient")
      .mockReturnValue(mockClient);

    loginMatrixSpy = vi
      .spyOn(clientModule, "loginMatrix")
      .mockResolvedValue({} as any);

    stopMatrixClientSpy = vi
      .spyOn(clientModule, "stopMatrixClient")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty array when no reactions", async () => {
    (mockClient.relations as any).mockResolvedValue({ events: [] });

    const { listMatrixReactions } = await import("./actions.js");
    const result = await listMatrixReactions("!room:test", "$event:test");

    expect(result).toEqual([]);
  });

  it("aggregates reactions by emoji key", async () => {
    const events = [
      createMockEvent({
        eventId: "$r1:test",
        sender: "@user1:matrix.org",
        relatesTo: { key: "👍" },
      }),
      createMockEvent({
        eventId: "$r2:test",
        sender: "@user2:matrix.org",
        relatesTo: { key: "👍" },
      }),
      createMockEvent({
        eventId: "$r3:test",
        sender: "@user3:matrix.org",
        relatesTo: { key: "🎉" },
      }),
    ];
    (mockClient.relations as any).mockResolvedValue({ events });

    const { listMatrixReactions } = await import("./actions.js");
    const result = await listMatrixReactions("!room:test", "$event:test");

    expect(result).toHaveLength(2);
    expect(result).toContainEqual({
      key: "👍",
      count: 2,
      senders: ["@user1:matrix.org", "@user2:matrix.org"],
    });
    expect(result).toContainEqual({
      key: "🎉",
      count: 1,
      senders: ["@user3:matrix.org"],
    });
  });
});

describe("editMatrixMessage", () => {
  let mockClient: MatrixClient;
  let loadConfigSpy: MockInstance;
  let createMatrixClientSpy: MockInstance;
  let loginMatrixSpy: MockInstance;
  let stopMatrixClientSpy: MockInstance;

  beforeEach(() => {
    mockClient = createMockClient();

    loadConfigSpy = vi.spyOn(configModule, "loadConfig").mockReturnValue({
      channels: {
        matrix: {
          homeserver: "https://matrix.org",
          userId: "@bot:matrix.org",
          accessToken: "test-token",
        },
      },
    } as ClawdbotConfig);

    createMatrixClientSpy = vi
      .spyOn(clientModule, "createMatrixClient")
      .mockReturnValue(mockClient);

    loginMatrixSpy = vi
      .spyOn(clientModule, "loginMatrix")
      .mockResolvedValue({} as any);

    stopMatrixClientSpy = vi
      .spyOn(clientModule, "stopMatrixClient")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends edit event with correct m.replace structure", async () => {
    const { editMatrixMessage } = await import("./actions.js");
    await editMatrixMessage("!room:test", "$event:test", "Updated content");

    expect(mockClient.sendEvent).toHaveBeenCalledWith(
      "!room:test",
      EventType.RoomMessage,
      expect.objectContaining({
        body: "* Updated content",
        msgtype: MsgType.Text,
        "m.new_content": {
          body: "Updated content",
          msgtype: MsgType.Text,
        },
        "m.relates_to": {
          rel_type: RelationType.Replace,
          event_id: "$event:test",
        },
      }),
    );
  });
});

describe("deleteMatrixMessage", () => {
  let mockClient: MatrixClient;
  let loadConfigSpy: MockInstance;
  let createMatrixClientSpy: MockInstance;
  let loginMatrixSpy: MockInstance;
  let stopMatrixClientSpy: MockInstance;

  beforeEach(() => {
    mockClient = createMockClient();

    loadConfigSpy = vi.spyOn(configModule, "loadConfig").mockReturnValue({
      channels: {
        matrix: {
          homeserver: "https://matrix.org",
          userId: "@bot:matrix.org",
          accessToken: "test-token",
        },
      },
    } as ClawdbotConfig);

    createMatrixClientSpy = vi
      .spyOn(clientModule, "createMatrixClient")
      .mockReturnValue(mockClient);

    loginMatrixSpy = vi
      .spyOn(clientModule, "loginMatrix")
      .mockResolvedValue({} as any);

    stopMatrixClientSpy = vi
      .spyOn(clientModule, "stopMatrixClient")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redacts message event", async () => {
    const { deleteMatrixMessage } = await import("./actions.js");
    await deleteMatrixMessage("!room:test", "$event:test");

    expect(mockClient.redactEvent).toHaveBeenCalledWith(
      "!room:test",
      "$event:test",
      undefined,
      { reason: undefined },
    );
  });

  it("includes reason when provided", async () => {
    const { deleteMatrixMessage } = await import("./actions.js");
    await deleteMatrixMessage("!room:test", "$event:test", { reason: "spam" });

    expect(mockClient.redactEvent).toHaveBeenCalledWith(
      "!room:test",
      "$event:test",
      undefined,
      { reason: "spam" },
    );
  });
});

describe("readMatrixMessages", () => {
  let mockClient: MatrixClient;
  let loadConfigSpy: MockInstance;
  let createMatrixClientSpy: MockInstance;
  let loginMatrixSpy: MockInstance;
  let stopMatrixClientSpy: MockInstance;

  beforeEach(() => {
    mockClient = createMockClient();

    loadConfigSpy = vi.spyOn(configModule, "loadConfig").mockReturnValue({
      channels: {
        matrix: {
          homeserver: "https://matrix.org",
          userId: "@bot:matrix.org",
          accessToken: "test-token",
        },
      },
    } as ClawdbotConfig);

    createMatrixClientSpy = vi
      .spyOn(clientModule, "createMatrixClient")
      .mockReturnValue(mockClient);

    loginMatrixSpy = vi
      .spyOn(clientModule, "loginMatrix")
      .mockResolvedValue({} as any);

    stopMatrixClientSpy = vi
      .spyOn(clientModule, "stopMatrixClient")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty messages when no history", async () => {
    (mockClient.createMessagesRequest as any).mockResolvedValue({ chunk: [] });

    const { readMatrixMessages } = await import("./actions.js");
    const result = await readMatrixMessages("!room:test");

    expect(result.messages).toEqual([]);
    expect(result.end).toBeUndefined();
  });

  it("returns messages with correct structure", async () => {
    (mockClient.createMessagesRequest as any).mockResolvedValue({
      chunk: [
        {
          type: "m.room.message",
          event_id: "$msg1:test",
          sender: "@user:test",
          content: { body: "Hello world", formatted_body: "<p>Hello world</p>" },
          origin_server_ts: 1234567890,
        },
        {
          type: "m.room.message",
          event_id: "$msg2:test",
          sender: "@other:test",
          content: { body: "Reply" },
          origin_server_ts: 1234567900,
        },
      ],
      end: "t12345",
    });

    const { readMatrixMessages } = await import("./actions.js");
    const result = await readMatrixMessages("!room:test");

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toMatchObject({
      eventId: "$msg1:test",
      sender: "@user:test",
      body: "Hello world",
      formattedBody: "<p>Hello world</p>",
      timestamp: 1234567890,
    });
    expect(result.messages[1]).toMatchObject({
      eventId: "$msg2:test",
      sender: "@other:test",
      body: "Reply",
      timestamp: 1234567900,
    });
    expect(result.end).toBe("t12345");
  });

  it("filters out non-message events", async () => {
    (mockClient.createMessagesRequest as any).mockResolvedValue({
      chunk: [
        { type: "m.room.message", event_id: "$msg:test", sender: "@user:test", content: { body: "Message" }, origin_server_ts: 1000 },
        { type: "m.room.member", event_id: "$mem:test", sender: "@user:test", content: {}, origin_server_ts: 2000 },
      ],
    });

    const { readMatrixMessages } = await import("./actions.js");
    const result = await readMatrixMessages("!room:test");

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].eventId).toBe("$msg:test");
  });

  it("uses default limit of 50", async () => {
    (mockClient.createMessagesRequest as any).mockResolvedValue({ chunk: [] });

    const { readMatrixMessages } = await import("./actions.js");
    await readMatrixMessages("!room:test");

    expect(mockClient.createMessagesRequest).toHaveBeenCalledWith(
      "!room:test",
      null,
      50,
      expect.anything(),
    );
  });

  it("uses custom limit when provided", async () => {
    (mockClient.createMessagesRequest as any).mockResolvedValue({ chunk: [] });

    const { readMatrixMessages } = await import("./actions.js");
    await readMatrixMessages("!room:test", { limit: 100 });

    expect(mockClient.createMessagesRequest).toHaveBeenCalledWith(
      "!room:test",
      null,
      100,
      expect.anything(),
    );
  });

  it("uses pagination token when provided", async () => {
    (mockClient.createMessagesRequest as any).mockResolvedValue({ chunk: [] });

    const { readMatrixMessages } = await import("./actions.js");
    await readMatrixMessages("!room:test", { from: "t12345" });

    expect(mockClient.createMessagesRequest).toHaveBeenCalledWith(
      "!room:test",
      "t12345",
      50,
      expect.anything(),
    );
  });
});

describe("joinMatrixRoom", () => {
  let mockClient: MatrixClient;
  let loadConfigSpy: MockInstance;
  let createMatrixClientSpy: MockInstance;
  let loginMatrixSpy: MockInstance;
  let stopMatrixClientSpy: MockInstance;

  beforeEach(() => {
    mockClient = createMockClient();

    loadConfigSpy = vi.spyOn(configModule, "loadConfig").mockReturnValue({
      channels: {
        matrix: {
          homeserver: "https://matrix.org",
          userId: "@bot:matrix.org",
          accessToken: "test-token",
        },
      },
    } as ClawdbotConfig);

    createMatrixClientSpy = vi
      .spyOn(clientModule, "createMatrixClient")
      .mockReturnValue(mockClient);

    loginMatrixSpy = vi
      .spyOn(clientModule, "loginMatrix")
      .mockResolvedValue({} as any);

    stopMatrixClientSpy = vi
      .spyOn(clientModule, "stopMatrixClient")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("joins room by ID and returns roomId", async () => {
    (mockClient.joinRoom as any).mockResolvedValue({ roomId: "!joined:matrix.org" });

    const { joinMatrixRoom } = await import("./actions.js");
    const result = await joinMatrixRoom("!room:matrix.org");

    expect(mockClient.joinRoom).toHaveBeenCalledWith("!room:matrix.org");
    expect(result.roomId).toBe("!joined:matrix.org");
  });

  it("joins room by alias", async () => {
    (mockClient.joinRoom as any).mockResolvedValue({ roomId: "!resolved:matrix.org" });

    const { joinMatrixRoom } = await import("./actions.js");
    const result = await joinMatrixRoom("#general:matrix.org");

    expect(mockClient.joinRoom).toHaveBeenCalledWith("#general:matrix.org");
    expect(result.roomId).toBe("!resolved:matrix.org");
  });
});

describe("leaveMatrixRoom", () => {
  let mockClient: MatrixClient;
  let loadConfigSpy: MockInstance;
  let createMatrixClientSpy: MockInstance;
  let loginMatrixSpy: MockInstance;
  let stopMatrixClientSpy: MockInstance;

  beforeEach(() => {
    mockClient = createMockClient();

    loadConfigSpy = vi.spyOn(configModule, "loadConfig").mockReturnValue({
      channels: {
        matrix: {
          homeserver: "https://matrix.org",
          userId: "@bot:matrix.org",
          accessToken: "test-token",
        },
      },
    } as ClawdbotConfig);

    createMatrixClientSpy = vi
      .spyOn(clientModule, "createMatrixClient")
      .mockReturnValue(mockClient);

    loginMatrixSpy = vi
      .spyOn(clientModule, "loginMatrix")
      .mockResolvedValue({} as any);

    stopMatrixClientSpy = vi
      .spyOn(clientModule, "stopMatrixClient")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("leaves the room", async () => {
    const { leaveMatrixRoom } = await import("./actions.js");
    await leaveMatrixRoom("!room:matrix.org");

    expect(mockClient.leave).toHaveBeenCalledWith("!room:matrix.org");
  });
});

describe("inviteToMatrixRoom", () => {
  let mockClient: MatrixClient;
  let loadConfigSpy: MockInstance;
  let createMatrixClientSpy: MockInstance;
  let loginMatrixSpy: MockInstance;
  let stopMatrixClientSpy: MockInstance;

  beforeEach(() => {
    mockClient = createMockClient();

    loadConfigSpy = vi.spyOn(configModule, "loadConfig").mockReturnValue({
      channels: {
        matrix: {
          homeserver: "https://matrix.org",
          userId: "@bot:matrix.org",
          accessToken: "test-token",
        },
      },
    } as ClawdbotConfig);

    createMatrixClientSpy = vi
      .spyOn(clientModule, "createMatrixClient")
      .mockReturnValue(mockClient);

    loginMatrixSpy = vi
      .spyOn(clientModule, "loginMatrix")
      .mockResolvedValue({} as any);

    stopMatrixClientSpy = vi
      .spyOn(clientModule, "stopMatrixClient")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("invites user to room", async () => {
    const { inviteToMatrixRoom } = await import("./actions.js");
    await inviteToMatrixRoom("!room:matrix.org", "@user:matrix.org");

    expect(mockClient.invite).toHaveBeenCalledWith("!room:matrix.org", "@user:matrix.org");
  });
});

describe("getMatrixUserProfile", () => {
  let mockClient: MatrixClient;
  let loadConfigSpy: MockInstance;
  let createMatrixClientSpy: MockInstance;
  let loginMatrixSpy: MockInstance;
  let stopMatrixClientSpy: MockInstance;

  beforeEach(() => {
    mockClient = createMockClient();

    loadConfigSpy = vi.spyOn(configModule, "loadConfig").mockReturnValue({
      channels: {
        matrix: {
          homeserver: "https://matrix.org",
          userId: "@bot:matrix.org",
          accessToken: "test-token",
        },
      },
    } as ClawdbotConfig);

    createMatrixClientSpy = vi
      .spyOn(clientModule, "createMatrixClient")
      .mockReturnValue(mockClient);

    loginMatrixSpy = vi
      .spyOn(clientModule, "loginMatrix")
      .mockResolvedValue({} as any);

    stopMatrixClientSpy = vi
      .spyOn(clientModule, "stopMatrixClient")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns user profile with all fields", async () => {
    (mockClient.getProfileInfo as any).mockResolvedValue({
      displayname: "Test User",
      avatar_url: "mxc://matrix.org/avatar123",
    });

    const { getMatrixUserProfile } = await import("./actions.js");
    const result = await getMatrixUserProfile("@user:matrix.org");

    expect(result).toEqual({
      userId: "@user:matrix.org",
      displayName: "Test User",
      avatarUrl: "mxc://matrix.org/avatar123",
    });
  });

  it("returns profile with undefined fields when not present", async () => {
    (mockClient.getProfileInfo as any).mockResolvedValue({});

    const { getMatrixUserProfile } = await import("./actions.js");
    const result = await getMatrixUserProfile("@user:matrix.org");

    expect(result).toEqual({
      userId: "@user:matrix.org",
      displayName: undefined,
      avatarUrl: undefined,
    });
  });
});

describe("getMatrixRoomMembers", () => {
  let mockClient: MatrixClient;
  let loadConfigSpy: MockInstance;
  let createMatrixClientSpy: MockInstance;
  let loginMatrixSpy: MockInstance;
  let stopMatrixClientSpy: MockInstance;

  beforeEach(() => {
    mockClient = createMockClient();

    loadConfigSpy = vi.spyOn(configModule, "loadConfig").mockReturnValue({
      channels: {
        matrix: {
          homeserver: "https://matrix.org",
          userId: "@bot:matrix.org",
          accessToken: "test-token",
        },
      },
    } as ClawdbotConfig);

    createMatrixClientSpy = vi
      .spyOn(clientModule, "createMatrixClient")
      .mockReturnValue(mockClient);

    loginMatrixSpy = vi
      .spyOn(clientModule, "loginMatrix")
      .mockResolvedValue({} as any);

    stopMatrixClientSpy = vi
      .spyOn(clientModule, "stopMatrixClient")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws error when room not found", async () => {
    (mockClient.getRoom as any).mockReturnValue(null);

    const { getMatrixRoomMembers } = await import("./actions.js");
    await expect(getMatrixRoomMembers("!room:test")).rejects.toThrow(
      "Room !room:test not found in client cache",
    );
  });

  it("returns room members as profiles", async () => {
    (mockClient.getRoom as any).mockReturnValue({
      getJoinedMembers: () => [
        { userId: "@user1:test", name: "User One", getMxcAvatarUrl: () => "mxc://test/1" },
        { userId: "@user2:test", name: "User Two", getMxcAvatarUrl: () => null },
      ],
    });

    const { getMatrixRoomMembers } = await import("./actions.js");
    const result = await getMatrixRoomMembers("!room:test");

    expect(result).toEqual([
      { userId: "@user1:test", displayName: "User One", avatarUrl: "mxc://test/1" },
      { userId: "@user2:test", displayName: "User Two", avatarUrl: undefined },
    ]);
  });
});

describe("getMatrixRoomInfo", () => {
  let mockClient: MatrixClient;
  let loadConfigSpy: MockInstance;
  let createMatrixClientSpy: MockInstance;
  let loginMatrixSpy: MockInstance;
  let stopMatrixClientSpy: MockInstance;

  beforeEach(() => {
    mockClient = createMockClient();

    loadConfigSpy = vi.spyOn(configModule, "loadConfig").mockReturnValue({
      channels: {
        matrix: {
          homeserver: "https://matrix.org",
          userId: "@bot:matrix.org",
          accessToken: "test-token",
        },
      },
    } as ClawdbotConfig);

    createMatrixClientSpy = vi
      .spyOn(clientModule, "createMatrixClient")
      .mockReturnValue(mockClient);

    loginMatrixSpy = vi
      .spyOn(clientModule, "loginMatrix")
      .mockResolvedValue({} as any);

    stopMatrixClientSpy = vi
      .spyOn(clientModule, "stopMatrixClient")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws error when room not found", async () => {
    (mockClient.getRoom as any).mockReturnValue(null);

    const { getMatrixRoomInfo } = await import("./actions.js");
    await expect(getMatrixRoomInfo("!room:test")).rejects.toThrow(
      "Room !room:test not found in client cache",
    );
  });

  it("returns room info with all fields", async () => {
    (mockClient.getRoom as any).mockReturnValue({
      name: "Test Room",
      currentState: {
        getStateEvents: (type: string) =>
          type === "m.room.topic"
            ? { getContent: () => ({ topic: "Room topic" }) }
            : null,
      },
      getJoinedMemberCount: () => 10,
      hasEncryptionStateEvent: () => true,
      getDMInviter: () => "@dm:test",
    });

    const { getMatrixRoomInfo } = await import("./actions.js");
    const result = await getMatrixRoomInfo("!room:test");

    expect(result).toEqual({
      roomId: "!room:test",
      name: "Test Room",
      topic: "Room topic",
      memberCount: 10,
      isEncrypted: true,
      isDirect: true,
    });
  });

  it("handles room with minimal info", async () => {
    (mockClient.getRoom as any).mockReturnValue({
      name: undefined,
      currentState: {
        getStateEvents: () => null,
      },
      getJoinedMemberCount: () => 2,
      hasEncryptionStateEvent: () => false,
      getDMInviter: () => undefined,
    });

    const { getMatrixRoomInfo } = await import("./actions.js");
    const result = await getMatrixRoomInfo("!room:test");

    expect(result).toEqual({
      roomId: "!room:test",
      name: undefined,
      topic: undefined,
      memberCount: 2,
      isEncrypted: false,
      isDirect: false,
    });
  });
});

describe("sendMatrixReadReceipt", () => {
  let mockClient: MatrixClient;
  let loadConfigSpy: MockInstance;
  let createMatrixClientSpy: MockInstance;
  let loginMatrixSpy: MockInstance;
  let stopMatrixClientSpy: MockInstance;

  beforeEach(() => {
    mockClient = createMockClient();

    loadConfigSpy = vi.spyOn(configModule, "loadConfig").mockReturnValue({
      channels: {
        matrix: {
          homeserver: "https://matrix.org",
          userId: "@bot:matrix.org",
          accessToken: "test-token",
        },
      },
    } as ClawdbotConfig);

    createMatrixClientSpy = vi
      .spyOn(clientModule, "createMatrixClient")
      .mockReturnValue(mockClient);

    loginMatrixSpy = vi
      .spyOn(clientModule, "loginMatrix")
      .mockResolvedValue({} as any);

    stopMatrixClientSpy = vi
      .spyOn(clientModule, "stopMatrixClient")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws error when room not found", async () => {
    (mockClient.getRoom as any).mockReturnValue(null);

    const { sendMatrixReadReceipt } = await import("./actions.js");
    await expect(
      sendMatrixReadReceipt("!room:test", "$event:test"),
    ).rejects.toThrow("Room !room:test not found in client cache");
  });

  it("throws error when event not found", async () => {
    (mockClient.getRoom as any).mockReturnValue({
      findEventById: () => null,
    });

    const { sendMatrixReadReceipt } = await import("./actions.js");
    await expect(
      sendMatrixReadReceipt("!room:test", "$event:test"),
    ).rejects.toThrow("Event $event:test not found in room !room:test");
  });

  it("sends read receipt for found event", async () => {
    const mockEvent = { getId: () => "$event:test" };
    (mockClient.getRoom as any).mockReturnValue({
      findEventById: (id: string) => (id === "$event:test" ? mockEvent : null),
    });

    const { sendMatrixReadReceipt } = await import("./actions.js");
    await sendMatrixReadReceipt("!room:test", "$event:test");

    expect(mockClient.sendReadReceipt).toHaveBeenCalledWith(mockEvent);
  });
});

describe("client management", () => {
  let loadConfigSpy: MockInstance;
  let createMatrixClientSpy: MockInstance;
  let loginMatrixSpy: MockInstance;
  let stopMatrixClientSpy: MockInstance;

  beforeEach(() => {
    loadConfigSpy = vi.spyOn(configModule, "loadConfig");
    createMatrixClientSpy = vi.spyOn(clientModule, "createMatrixClient");
    loginMatrixSpy = vi.spyOn(clientModule, "loginMatrix");
    stopMatrixClientSpy = vi.spyOn(clientModule, "stopMatrixClient");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws error when homeserver not configured", async () => {
    loadConfigSpy.mockReturnValue({
      channels: {
        matrix: {
          userId: "@bot:matrix.org",
          accessToken: "test-token",
        },
      },
    } as ClawdbotConfig);

    const { reactMatrixMessage } = await import("./actions.js");
    await expect(
      reactMatrixMessage("!room:test", "$event:test", "👍"),
    ).rejects.toThrow('Matrix homeserver not configured for account "default"');
  });

  it("throws error when credentials not configured", async () => {
    loadConfigSpy.mockReturnValue({
      channels: {
        matrix: {
          homeserver: "https://matrix.org",
          userId: "@bot:matrix.org",
        },
      },
    } as ClawdbotConfig);

    const { reactMatrixMessage } = await import("./actions.js");
    await expect(
      reactMatrixMessage("!room:test", "$event:test", "👍"),
    ).rejects.toThrow(
      'Matrix credentials not configured for account "default"',
    );
  });

  it("stops client even when action fails", async () => {
    const mockClient = createMockClient({
      sendEvent: vi.fn().mockRejectedValue(new Error("Network error")),
    });

    loadConfigSpy.mockReturnValue({
      channels: {
        matrix: {
          homeserver: "https://matrix.org",
          userId: "@bot:matrix.org",
          accessToken: "test-token",
        },
      },
    } as ClawdbotConfig);
    createMatrixClientSpy.mockReturnValue(mockClient);
    loginMatrixSpy.mockResolvedValue({} as any);
    stopMatrixClientSpy.mockResolvedValue(undefined);

    const { reactMatrixMessage } = await import("./actions.js");
    await expect(
      reactMatrixMessage("!room:test", "$event:test", "👍"),
    ).rejects.toThrow("Network error");

    expect(stopMatrixClientSpy).toHaveBeenCalledWith(mockClient);
  });
});
