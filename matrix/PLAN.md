# Matrix Provider Implementation Plan (TypeScript Native)

## Overview

Implement Matrix as a native TypeScript channel in Clawdbot, following Discord/Slack provider patterns. Uses `matrix-js-sdk` for Matrix protocol handling.

**Reference Implementations:** `src/discord/`, `src/slack/`

---

## Architecture

```
src/matrix/
├── index.ts                    # All exports
├── accounts.ts                 # Account resolution from config
├── actions.ts                  # Standalone action functions (Slack pattern)
├── client.ts                   # Matrix client lifecycle
├── format.ts                   # Message formatting (markdown ↔ HTML)
├── probe.ts                    # Health check / connection status
├── send.ts                     # Send messages to Matrix rooms
├── token.ts                    # Credential handling
├── types.ts                    # Shared types
└── monitor/
    ├── provider.ts             # Main entry: monitorMatrixProvider()
    ├── allow-list.ts           # AllowFrom filtering logic
    ├── events/                 # Event handlers (Slack pattern)
    │   ├── index.ts
    │   ├── messages.ts         # m.room.message
    │   ├── reactions.ts        # m.reaction
    │   ├── members.ts          # m.room.member
    │   └── rooms.ts            # m.room.create, tombstone, etc.
    ├── message-handler/
    │   ├── index.ts
    │   ├── preflight.ts        # Pre-routing checks
    │   └── process.ts          # Message processing
    ├── context.ts              # Monitor context/state
    └── types.ts                # Monitor-specific types
```

---

## Step 1: Dependencies (P0)

**File:** `package.json`

- [ ] Add `matrix-js-sdk` dependency:
  ```json
  "matrix-js-sdk": "^34.0.0"
  ```

---

## Step 2: Channel Registry (P0)

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

## Step 3: Config Schema (P0)

**File:** `src/config/zod-schema.providers-core.ts`

- [ ] Add `MatrixRoomSchema`:
  ```typescript
  export const MatrixRoomSchema = z.object({
    enabled: z.boolean().optional(),
    allow: z.boolean().optional(),
    requireMention: z.boolean().optional(),
    users: z.array(z.string()).optional(),
    skills: z.array(z.string()).optional(),
    systemPrompt: z.string().optional(),
  });
  ```

- [ ] Add `MatrixDmSchema`:
  ```typescript
  export const MatrixDmSchema = z.object({
    enabled: z.boolean().optional(),
    policy: DmPolicySchema.optional().default("pairing"),
    allowFrom: z.array(z.string()).optional(),
  }).superRefine(requireOpenAllowFrom);
  ```

- [ ] Add `MatrixAccountSchema`:
  ```typescript
  export const MatrixAccountSchema = z.object({
    name: z.string().optional(),
    capabilities: z.array(z.string()).optional(),
    enabled: z.boolean().optional(),
    commands: ProviderCommandsSchema,
    // Connection
    homeserver: z.string(),
    userId: z.string(),
    accessToken: z.string().optional(),
    password: z.string().optional(),
    deviceId: z.string().optional(),
    // Policies
    groupPolicy: GroupPolicySchema.optional().default("allowlist"),
    historyLimit: z.number().int().min(0).optional(),
    dmHistoryLimit: z.number().int().min(0).optional(),
    dms: z.record(z.string(), DmConfigSchema.optional()).optional(),
    // Limits
    textChunkLimit: z.number().int().positive().optional(),
    mediaMaxMb: z.number().positive().optional(),
    // Features
    replyToMode: ReplyToModeSchema.optional(),
    reactionNotifications: z.enum(["off", "own", "all", "allowlist"]).optional(),
    reactionAllowlist: z.array(z.string()).optional(),
    actions: z.object({
      reactions: z.boolean().optional(),
      messages: z.boolean().optional(),
      read: z.boolean().optional(),
      pins: z.boolean().optional(),
      memberInfo: z.boolean().optional(),
      roomInfo: z.boolean().optional(),
    }).optional(),
    dm: MatrixDmSchema.optional(),
    rooms: z.record(z.string(), MatrixRoomSchema.optional()).optional(),
  }).superRefine((val, ctx) => {
    if (!val.accessToken && !val.password) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Either accessToken or password is required",
      });
    }
  });
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

## Step 4: Types (P0)

**File:** `src/matrix/types.ts`

```typescript
export type MatrixMessageEvent = {
  eventId: string;
  roomId: string;
  sender: string;
  body: string;
  formattedBody?: string;
  msgtype: string;
  replyTo?: string;
  timestamp: number;
};

export type MatrixActionOpts = {
  accountId?: string;
  accessToken?: string;
  client?: MatrixClient;
};

export type MatrixRoomInfo = {
  roomId: string;
  name?: string;
  topic?: string;
  memberCount: number;
  isEncrypted: boolean;
  isDirect: boolean;
};

export type MatrixUserProfile = {
  userId: string;
  displayName?: string;
  avatarUrl?: string;
};
```

---

## Step 5: Client Lifecycle (P1)

**File:** `src/matrix/client.ts`

- [ ] `createMatrixClient(opts)` — create client instance
- [ ] `loginMatrix(client, opts)` — login with token or password
- [ ] `startMatrixSync(client)` — start sync loop
- [ ] `stopMatrixClient(client)` — graceful shutdown
- [ ] Handle reconnection on network errors
- [ ] Export client singleton management

---

## Step 6: Account Resolution (P1)

**File:** `src/matrix/accounts.ts`

- [ ] `resolveMatrixAccount({ cfg, accountId })` — resolve account config
- [ ] `listMatrixAccountIds(cfg)` — list configured accounts
- [ ] `listEnabledMatrixAccounts(cfg)` — list enabled accounts
- [ ] `resolveDefaultMatrixAccountId(cfg)` — get default account

**File:** `src/matrix/token.ts`

- [ ] `resolveMatrixCredentials(opts)` — resolve accessToken or password

---

## Step 7: Actions Module (P1)

**File:** `src/matrix/actions.ts`

Following Slack's pattern — standalone functions for all Matrix actions:

### Reactions
- [ ] `reactMatrixMessage(roomId, eventId, emoji, opts)` — add reaction
- [ ] `removeMatrixReaction(roomId, eventId, emoji, opts)` — remove reaction
- [ ] `removeOwnMatrixReactions(roomId, eventId, opts)` — remove all own reactions
- [ ] `listMatrixReactions(roomId, eventId, opts)` — get reactions on message

### Messages
- [ ] `sendMatrixMessage(roomId, body, opts)` — send message (alias for send.ts)
- [ ] `editMatrixMessage(roomId, eventId, newBody, opts)` — edit message
- [ ] `deleteMatrixMessage(roomId, eventId, opts)` — redact message
- [ ] `readMatrixMessages(roomId, opts)` — fetch room history

### Read Receipts
- [ ] `sendMatrixReadReceipt(roomId, eventId, opts)` — mark as read

### Room Management
- [ ] `joinMatrixRoom(roomIdOrAlias, opts)` — join room
- [ ] `leaveMatrixRoom(roomId, opts)` — leave room
- [ ] `inviteToMatrixRoom(roomId, userId, opts)` — invite user

### User/Room Info
- [ ] `getMatrixUserProfile(userId, opts)` — get user profile
- [ ] `getMatrixRoomMembers(roomId, opts)` — list room members
- [ ] `getMatrixRoomInfo(roomId, opts)` — get room details

---

## Step 8: Send Messages (P1)

**File:** `src/matrix/send.ts`

- [ ] `sendMessageMatrix(opts)`:
  ```typescript
  export async function sendMessageMatrix(opts: {
    roomId: string;
    body: string;
    formatted?: boolean;
    replyTo?: string;
    accountId?: string;
  }): Promise<{ eventId: string }>
  ```
- [ ] Handle message chunking for long messages
- [ ] Handle markdown → HTML conversion
- [ ] Handle reply threading (`m.relates_to.m.in_reply_to`)
- [ ] Handle media attachments (images, files)

**File:** `src/matrix/format.ts`

- [ ] `markdownToMatrixHtml(md)` — convert markdown to Matrix HTML
- [ ] `matrixHtmlToPlaintext(html)` — strip HTML for plain body
- [ ] `formatMatrixReply(originalEvent, newBody)` — format reply with quote

---

## Step 9: Probe / Health (P1)

**File:** `src/matrix/probe.ts`

- [ ] `probeMatrix(opts)`:
  ```typescript
  export async function probeMatrix(opts?: {
    accountId?: string;
  }): Promise<{
    connected: boolean;
    userId?: string;
    homeserver?: string;
    syncState?: string;
    error?: string;
  }>
  ```

---

## Step 10: Monitor Provider (P1)

**File:** `src/matrix/monitor/provider.ts`

- [ ] `monitorMatrixProvider(opts)`:
  - Load config via `resolveMatrixAccount()`
  - Create Matrix client
  - Login (accessToken or password)
  - Create monitor context
  - Register event handlers
  - Start sync loop
  - Return cleanup handle

**File:** `src/matrix/monitor/context.ts`

- [ ] `createMatrixMonitorContext(opts)` — shared state for handlers:
  - Client reference
  - Account config
  - Runtime (log, error, exit)
  - Bot user ID
  - AllowFrom rules

---

## Step 11: Event Handlers (P1)

**File:** `src/matrix/monitor/events/index.ts`

- [ ] `registerMatrixEvents(client, context)` — register all event handlers

**File:** `src/matrix/monitor/events/messages.ts`

- [ ] Handle `Room.timeline` events
- [ ] Filter `m.room.message` type
- [ ] Skip historical messages (toStartOfTimeline)
- [ ] Skip own messages (bot self-filter)
- [ ] Route to message handler

**File:** `src/matrix/monitor/events/reactions.ts`

- [ ] Handle `m.reaction` events
- [ ] Check reactionNotifications setting
- [ ] Emit reaction notifications if enabled

**File:** `src/matrix/monitor/events/members.ts`

- [ ] Handle `m.room.member` events
- [ ] Track joins/leaves if needed

**File:** `src/matrix/monitor/events/rooms.ts`

- [ ] Handle room invites (auto-join if from allowed user?)
- [ ] Handle room upgrades (tombstone)

---

## Step 12: AllowFrom Filtering (P1)

**File:** `src/matrix/monitor/allow-list.ts`

- [ ] `normalizeMatrixAllowList(raw)` — normalize user IDs
- [ ] `isMatrixUserAllowed(userId, allowFrom)` — check DM allowlist
- [ ] `isMatrixRoomAllowed(roomId, config)` — check room allowlist
- [ ] `resolveMatrixRoomConfig(roomId, config)` — get per-room settings
- [ ] `resolveMatrixShouldRequireMention(roomConfig)` — check mention requirement

---

## Step 13: Message Handler (P1)

**File:** `src/matrix/monitor/message-handler/index.ts`

- [ ] `createMatrixMessageHandler(context)` — factory for handler

**File:** `src/matrix/monitor/message-handler/preflight.ts`

- [ ] Check if sender is allowed (DM policy, allowFrom)
- [ ] Check if room is allowed (room config)
- [ ] Check for mention/trigger if required
- [ ] Filter bot's own messages

**File:** `src/matrix/monitor/message-handler/process.ts`

- [ ] Extract message content (body, formatted_body)
- [ ] Parse reply context if present
- [ ] Build message event for session routing
- [ ] Route to session via `resolveAgentRoute()`

---

## Step 14: Channel Plugin (P1)

**File:** `src/channels/plugins/matrix.ts`

```typescript
import { monitorMatrixProvider } from "../../matrix/monitor/provider.js";
import { sendMessageMatrix } from "../../matrix/send.js";
import { probeMatrix } from "../../matrix/probe.js";
import type { ChannelPlugin } from "./types.js";

export const matrixChannelPlugin: ChannelPlugin = {
  id: "matrix",
  monitor: monitorMatrixProvider,
  send: sendMessageMatrix,
  probe: probeMatrix,
};
```

**File:** `src/channels/plugins/index.ts`

- [ ] Import `matrixChannelPlugin`
- [ ] Add to channel plugins map

---

## Step 15: Index Exports (P1)

**File:** `src/matrix/index.ts`

```typescript
// Account management
export {
  listEnabledMatrixAccounts,
  listMatrixAccountIds,
  resolveDefaultMatrixAccountId,
  resolveMatrixAccount,
} from "./accounts.js";

// Actions (Slack pattern)
export {
  deleteMatrixMessage,
  editMatrixMessage,
  getMatrixRoomInfo,
  getMatrixRoomMembers,
  getMatrixUserProfile,
  inviteToMatrixRoom,
  joinMatrixRoom,
  leaveMatrixRoom,
  listMatrixReactions,
  reactMatrixMessage,
  readMatrixMessages,
  removeMatrixReaction,
  removeOwnMatrixReactions,
  sendMatrixReadReceipt,
} from "./actions.js";

// Core
export { monitorMatrixProvider } from "./monitor/provider.js";
export { probeMatrix } from "./probe.js";
export { sendMessageMatrix } from "./send.js";
export { resolveMatrixCredentials } from "./token.js";

// Types
export type {
  MatrixActionOpts,
  MatrixMessageEvent,
  MatrixRoomInfo,
  MatrixUserProfile,
} from "./types.js";
```

---

## Step 16: Testing (P2)

**File:** `src/matrix/actions.test.ts`
- [ ] Unit tests for action functions

**File:** `src/matrix/monitor/allow-list.test.ts`
- [ ] Unit tests for allowFrom filtering

**File:** `src/matrix/monitor/message-handler.test.ts`
- [ ] Unit tests for message processing

**File:** `src/matrix/format.test.ts`
- [ ] Unit tests for markdown ↔ HTML

**Integration tests:**
- [ ] Test with local Synapse instance
- [ ] Test DM flow
- [ ] Test group room flow
- [ ] Test reactions
- [ ] Test message editing/deletion

---

## Step 17: Documentation (P2)

- [ ] Add `docs/channels/matrix.md`
- [ ] Document config options
- [ ] Document setup steps (create bot account, get token)
- [ ] Update onboarding wizard for Matrix option

---

## File Checklist

### New Files (19 files)
- [ ] `src/matrix/index.ts`
- [ ] `src/matrix/accounts.ts`
- [ ] `src/matrix/actions.ts`
- [ ] `src/matrix/client.ts`
- [ ] `src/matrix/format.ts`
- [ ] `src/matrix/probe.ts`
- [ ] `src/matrix/send.ts`
- [ ] `src/matrix/token.ts`
- [ ] `src/matrix/types.ts`
- [ ] `src/matrix/monitor/provider.ts`
- [ ] `src/matrix/monitor/allow-list.ts`
- [ ] `src/matrix/monitor/context.ts`
- [ ] `src/matrix/monitor/types.ts`
- [ ] `src/matrix/monitor/events/index.ts`
- [ ] `src/matrix/monitor/events/messages.ts`
- [ ] `src/matrix/monitor/events/reactions.ts`
- [ ] `src/matrix/monitor/events/members.ts`
- [ ] `src/matrix/monitor/events/rooms.ts`
- [ ] `src/matrix/monitor/message-handler/index.ts`
- [ ] `src/matrix/monitor/message-handler/preflight.ts`
- [ ] `src/matrix/monitor/message-handler/process.ts`
- [ ] `src/channels/plugins/matrix.ts`

### Modified Files (4 files)
- [ ] `package.json` — add matrix-js-sdk
- [ ] `src/channels/registry.ts` — add "matrix" to order + meta
- [ ] `src/config/zod-schema.providers-core.ts` — add Matrix schemas
- [ ] `src/config/zod-schema.providers.ts` — add matrix to ChannelsSchema
- [ ] `src/channels/plugins/index.ts` — register matrix plugin

---

## E2EE Considerations (P2)

matrix-js-sdk supports E2EE but requires:
- `@matrix-org/olm` WebAssembly library
- Crypto store persistence (`indexedDB` or file-based)
- Device verification flow

**Recommendation:** Implement without E2EE first, add as enhancement.

---

## Open Questions

- [ ] Auto-join rooms on invite from allowed users?
- [ ] Handle room upgrades (tombstone → new room)?
- [ ] Support spaces (room hierarchies)?
- [ ] Typing indicators (`m.typing`)?

---

*Created 2026-01-14 | Updated 2026-01-14*
