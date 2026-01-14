# Matrix Provider Implementation Plan (TypeScript Native)

## Overview

Implement Matrix as a native TypeScript channel in Clawdbot, following the Discord provider pattern. Uses `matrix-js-sdk` for Matrix protocol handling.

**Reference Implementation:** `src/discord/`

---

## Architecture

```
src/matrix/
├── index.ts              # Exports: monitorMatrixProvider, sendMessageMatrix
├── accounts.ts           # Account resolution from config
├── probe.ts              # Health check / connection status
├── send.ts               # Send messages to Matrix rooms
├── token.ts              # Token/credential handling
└── monitor/
    ├── provider.ts       # Main entry: monitorMatrixProvider()
    ├── allow-list.ts     # AllowFrom filtering logic
    ├── listeners.ts      # Event registration
    ├── message-handler.ts        # Route messages to sessions
    ├── message-handler.preflight.ts  # Pre-routing checks
    ├── message-handler.process.ts    # Process incoming messages
    └── message-utils.ts  # Formatting, media handling
```

---

## Step 1: Channel Registry (P0)

**File:** `src/channels/registry.ts`

- [ ] Add `"matrix"` to `CHAT_CHANNEL_ORDER` array
- [ ] Add Matrix entry to `CHAT_CHANNEL_META`:
  ```typescript
  matrix: {
    id: "matrix",
    label: "Matrix",
    selectionLabel: "Matrix (matrix-js-sdk)",
    docsPath: "/channels/matrix",
    blurb: "federated, E2EE-capable chat protocol (Element, etc.)",
  },
  ```

---

## Step 2: Config Schema (P0)

**File:** `src/config/zod-schema.providers-core.ts`

- [ ] Add `MatrixRoomSchema` for per-room config:
  ```typescript
  export const MatrixRoomSchema = z.object({
    enabled: z.boolean().optional(),
    allow: z.boolean().optional(),
    requireMention: z.boolean().optional(),
    users: z.array(z.string()).optional(),  // @user:server.com
    skills: z.array(z.string()).optional(),
    systemPrompt: z.string().optional(),
  });
  ```

- [ ] Add `MatrixDmSchema`:
  ```typescript
  export const MatrixDmSchema = z.object({
    enabled: z.boolean().optional(),
    policy: DmPolicySchema.optional().default("pairing"),
    allowFrom: z.array(z.string()).optional(),  // @user:server.com
  }).superRefine(/* requireOpenAllowFrom */);
  ```

- [ ] Add `MatrixAccountSchema`:
  ```typescript
  export const MatrixAccountSchema = z.object({
    name: z.string().optional(),
    capabilities: z.array(z.string()).optional(),
    enabled: z.boolean().optional(),
    commands: ProviderCommandsSchema,
    homeserver: z.string(),  // https://matrix.org
    userId: z.string(),      // @bot:matrix.org
    accessToken: z.string().optional(),
    password: z.string().optional(),
    deviceId: z.string().optional(),
    storeDir: z.string().optional(),
    groupPolicy: GroupPolicySchema.optional().default("allowlist"),
    historyLimit: z.number().int().min(0).optional(),
    dmHistoryLimit: z.number().int().min(0).optional(),
    dms: z.record(z.string(), DmConfigSchema.optional()).optional(),
    textChunkLimit: z.number().int().positive().optional(),
    mediaMaxMb: z.number().positive().optional(),
    replyToMode: ReplyToModeSchema.optional(),
    actions: z.object({
      reactions: z.boolean().optional(),
      messages: z.boolean().optional(),
      read: z.boolean().optional(),
    }).optional(),
    dm: MatrixDmSchema.optional(),
    rooms: z.record(z.string(), MatrixRoomSchema.optional()).optional(),
  }).superRefine(/* require accessToken XOR password */);
  ```

- [ ] Add `MatrixConfigSchema`:
  ```typescript
  export const MatrixConfigSchema = MatrixAccountSchema.extend({
    accounts: z.record(z.string(), MatrixAccountSchema.optional()).optional(),
  });
  ```

**File:** `src/config/zod-schema.providers.ts`

- [ ] Import `MatrixConfigSchema`
- [ ] Add `matrix: MatrixConfigSchema.optional()` to `ChannelsSchema`

---

## Step 3: Provider Scaffold (P0)

**File:** `src/matrix/index.ts`

```typescript
export { monitorMatrixProvider } from "./monitor/provider.js";
export { sendMessageMatrix } from "./send.js";
export { probeMatrix } from "./probe.js";
// Re-export types
export type { MatrixMessageEvent, MatrixMessageHandler } from "./monitor/listeners.js";
```

**File:** `src/matrix/accounts.ts`

- [ ] Implement `resolveMatrixAccount()` — resolve account from config
- [ ] Handle default account vs named accounts

**File:** `src/matrix/token.ts`

- [ ] Implement `normalizeMatrixCredentials()` — handle accessToken vs password

---

## Step 4: Matrix Client Setup (P1)

**File:** `src/matrix/client.ts`

- [ ] Import `matrix-js-sdk`:
  ```typescript
  import sdk from "matrix-js-sdk";
  ```

- [ ] Implement `createMatrixClient()`:
  ```typescript
  export function createMatrixClient(opts: {
    homeserver: string;
    userId: string;
    accessToken?: string;
    deviceId?: string;
  }): MatrixClient {
    return sdk.createClient({
      baseUrl: opts.homeserver,
      accessToken: opts.accessToken,
      userId: opts.userId,
      deviceId: opts.deviceId,
    });
  }
  ```

- [ ] Implement `loginWithPassword()` for password-based auth
- [ ] Handle client lifecycle (start, stop, reconnect)

---

## Step 5: Monitor Provider (P1)

**File:** `src/matrix/monitor/provider.ts`

- [ ] Implement `monitorMatrixProvider(opts)`:
  - Load config via `resolveMatrixAccount()`
  - Create Matrix client
  - Login (accessToken or password)
  - Register event listeners
  - Start sync loop
  - Return cleanup handle

**File:** `src/matrix/monitor/listeners.ts`

- [ ] Implement `registerMatrixListener()`:
  ```typescript
  client.on("Room.timeline", (event, room, toStartOfTimeline) => {
    if (event.getType() !== "m.room.message") return;
    if (toStartOfTimeline) return; // Skip historical
    handler(event, room);
  });
  ```

**File:** `src/matrix/monitor/allow-list.ts`

- [ ] Implement `isMatrixUserAllowed()` — check allowFrom
- [ ] Implement `isMatrixRoomAllowed()` — check room allowlist
- [ ] Implement `resolveMatrixRoomConfig()` — get per-room settings

---

## Step 6: Message Handler (P1)

**File:** `src/matrix/monitor/message-handler.ts`

- [ ] Implement `createMatrixMessageHandler()`:
  - Extract sender, room, body, eventId
  - Check allowFrom filtering
  - Check mention/trigger requirements
  - Route to session via `resolveAgentRoute()`

**File:** `src/matrix/monitor/message-handler.preflight.ts`

- [ ] Pre-routing checks (bot self-filter, room policy)

**File:** `src/matrix/monitor/message-handler.process.ts`

- [ ] Process message content
- [ ] Handle formatted_body (HTML → text)
- [ ] Handle reply threading context

---

## Step 7: Send Messages (P1)

**File:** `src/matrix/send.ts`

- [ ] Implement `sendMessageMatrix()`:
  ```typescript
  export async function sendMessageMatrix(opts: {
    roomId: string;
    body: string;
    replyTo?: string;
    formatted?: boolean;
  }): Promise<{ eventId: string }> {
    const content: IContent = {
      msgtype: "m.text",
      body: opts.body,
    };
    if (opts.formatted) {
      content.format = "org.matrix.custom.html";
      content.formatted_body = markdownToHtml(opts.body);
    }
    if (opts.replyTo) {
      content["m.relates_to"] = {
        "m.in_reply_to": { event_id: opts.replyTo },
      };
    }
    const res = await client.sendEvent(opts.roomId, "m.room.message", content);
    return { eventId: res.event_id };
  }
  ```

- [ ] Handle message chunking for long messages
- [ ] Handle media attachments (images, files)

---

## Step 8: Probe / Health Check (P1)

**File:** `src/matrix/probe.ts`

- [ ] Implement `probeMatrix()`:
  - Check client sync state
  - Return connection status, userId, homeserver

---

## Step 9: Channel Plugin Registration (P1)

**File:** `src/channels/plugins/index.ts`

- [ ] Import Matrix provider
- [ ] Register in channel plugins map

**File:** `src/channels/plugins/matrix.ts`

- [ ] Implement Matrix channel plugin:
  ```typescript
  export const matrixChannelPlugin: ChannelPlugin = {
    id: "matrix",
    monitor: monitorMatrixProvider,
    send: sendMessageMatrix,
    probe: probeMatrix,
  };
  ```

---

## Step 10: Dependencies (P0)

**File:** `package.json`

- [ ] Add `matrix-js-sdk` dependency:
  ```json
  "matrix-js-sdk": "^34.0.0"
  ```

---

## Step 11: Testing (P2)

- [ ] Unit tests for allow-list filtering
- [ ] Unit tests for message handler
- [ ] Integration test with local Synapse
- [ ] Test E2EE room (if supported by matrix-js-sdk)

---

## Step 12: Documentation (P2)

- [ ] Add `docs/channels/matrix.md`
- [ ] Update channel selection in onboarding

---

## File Checklist

### New Files
- [ ] `src/matrix/index.ts`
- [ ] `src/matrix/accounts.ts`
- [ ] `src/matrix/client.ts`
- [ ] `src/matrix/probe.ts`
- [ ] `src/matrix/send.ts`
- [ ] `src/matrix/token.ts`
- [ ] `src/matrix/monitor/provider.ts`
- [ ] `src/matrix/monitor/allow-list.ts`
- [ ] `src/matrix/monitor/listeners.ts`
- [ ] `src/matrix/monitor/message-handler.ts`
- [ ] `src/matrix/monitor/message-handler.preflight.ts`
- [ ] `src/matrix/monitor/message-handler.process.ts`
- [ ] `src/matrix/monitor/message-utils.ts`
- [ ] `src/channels/plugins/matrix.ts`

### Modified Files
- [ ] `src/channels/registry.ts` — add "matrix" to order + meta
- [ ] `src/config/zod-schema.providers-core.ts` — add Matrix schemas
- [ ] `src/config/zod-schema.providers.ts` — add matrix to ChannelsSchema
- [ ] `src/channels/plugins/index.ts` — register matrix plugin
- [ ] `package.json` — add matrix-js-sdk

---

## E2EE Considerations

matrix-js-sdk supports E2EE but requires:
- `olm` library (WebAssembly or native)
- Device verification flow
- Crypto store persistence

**Recommendation:** Start without E2EE, add as P2 enhancement.

---

## Open Questions

- [ ] Auto-join rooms on invite from allowed users?
- [ ] Handle room upgrades (tombstone events)?
- [ ] Support spaces (room hierarchies)?

---

*Created 2026-01-14*
