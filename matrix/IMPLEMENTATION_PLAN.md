# Matrix Provider Implementation Plan

## Legend
- `[ ]` Not started
- `[~]` In progress
- `[x]` Complete
- `[!]` Blocked

## Priority Levels
- **P0**: Critical path, must complete first
- **P1**: Important, complete after P0
- **P2**: Nice to have, complete if time permits

---

## P0: Foundation (Dependencies & Config)

### P0.1: Package Dependencies
- [x] Add `matrix-js-sdk` to package.json dependencies (`pnpm add matrix-js-sdk`)

### P0.2: Channel Registry
- [x] Add `"matrix"` to CHAT_CHANNEL_ORDER in `src/channels/registry.ts`
- [x] Add Matrix entry to CHAT_CHANNEL_META in `src/channels/registry.ts`
- [x] Add `"element": "matrix"` alias to CHAT_CHANNEL_ALIASES (optional)

### P0.3: Config Schema - Room/DM Schemas
- [x] Create MatrixRoomSchema in `src/config/zod-schema.providers-core.ts`
- [x] Create MatrixDmSchema in `src/config/zod-schema.providers-core.ts` (with superRefine for open policy)

### P0.4: Config Schema - Account Schema
- [x] Create MatrixAccountSchema in `src/config/zod-schema.providers-core.ts`
  - Connection: homeserver, userId, accessToken/password, deviceId
  - Policies: groupPolicy, historyLimit, dmHistoryLimit, dms
  - Features: replyToMode, reactionNotifications, reactionAllowlist
  - Actions: reactions, messages, read, pins, memberInfo, roomInfo
  - Limits: textChunkLimit, mediaMaxMb

### P0.5: Config Schema - Top-level
- [x] Create MatrixConfigSchema extending MatrixAccountSchema with accounts record
- [x] Import and add matrix to ChannelsSchema in `src/config/zod-schema.providers.ts`

---

## P1: Core Types & Client (src/matrix/)

### P1.1: Types Module
- [x] Create `src/matrix/types.ts` with:
  - MatrixMessageEvent type
  - MatrixActionOpts type
  - MatrixRoomInfo type
  - MatrixUserProfile type

### P1.2: Token/Credentials
- [x] Create `src/matrix/token.ts` with resolveMatrixCredentials()
  - Handle accessToken vs password auth
  - Support env vars (MATRIX_ACCESS_TOKEN, MATRIX_PASSWORD)

### P1.3: Accounts Module
- [x] Create `src/matrix/accounts.ts` with:
  - resolveMatrixAccount({ cfg, accountId })
  - listMatrixAccountIds(cfg)
  - listEnabledMatrixAccounts(cfg)
  - resolveDefaultMatrixAccountId(cfg)

### P1.4: Client Lifecycle
- [x] Create `src/matrix/client.ts` with:
  - createMatrixClient(opts) - create client instance
  - loginMatrix(client, opts) - login with token or password
  - startMatrixSync(client) - start sync loop
  - stopMatrixClient(client) - graceful shutdown
  - Handle reconnection on network errors

### P1.5: Message Formatting
- [x] Create `src/matrix/format.ts` with:
  - markdownToMatrixHtml(md) - convert markdown to Matrix HTML
  - matrixHtmlToPlaintext(html) - strip HTML for plain body
  - formatMatrixReply(originalEvent, newBody) - format reply with quote
  - extractMatrixMentions(body) - extract @user:server mentions
  - containsMatrixMention(body, userId) - check for specific mention

### P1.6: Typing Indicators
- [x] Create `src/matrix/typing.ts` with:
  - sendMatrixTyping({ client, roomId, typing, timeoutMs })
  - stopMatrixTyping({ client, roomId })

### P1.7: Send Messages
- [x] Create `src/matrix/send.ts` with sendMessageMatrix():
  - Handle message chunking for long messages
  - Handle markdown -> HTML conversion
  - Handle reply threading (m.relates_to.m.in_reply_to)
  - Handle media attachments (images, files)

### P1.8: Probe/Health Check
- [x] Create `src/matrix/probe.ts` with probeMatrix():
  - Return { ok, status, error, elapsedMs, user, homeserver, syncState }

---

## P1: Actions Module (src/matrix/actions.ts)

### P1.9: Create Actions Module
- [x] Create `src/matrix/actions.ts` with getClient() helper

### P1.10: Reaction Actions
- [x] Add reactMatrixMessage(roomId, eventId, emoji, opts)
- [x] Add removeMatrixReaction(roomId, eventId, emoji, opts)
- [x] Add removeOwnMatrixReactions(roomId, eventId, opts)
- [x] Add listMatrixReactions(roomId, eventId, opts)

### P1.11: Message Actions
- [x] Add sendMatrixMessage(roomId, body, opts) - alias for send.ts
- [x] Add editMatrixMessage(roomId, eventId, newBody, opts)
- [x] Add deleteMatrixMessage(roomId, eventId, opts) - redact
- [x] Add readMatrixMessages(roomId, opts) - fetch room history

### P1.12: Read Receipt Actions
- [x] Add sendMatrixReadReceipt(roomId, eventId, opts)

### P1.13: Room Management Actions
- [x] Add joinMatrixRoom(roomIdOrAlias, opts)
- [x] Add leaveMatrixRoom(roomId, opts)
- [x] Add inviteToMatrixRoom(roomId, userId, opts)

### P1.14: User/Room Info Actions
- [x] Add getMatrixUserProfile(userId, opts)
- [x] Add getMatrixRoomMembers(roomId, opts)
- [x] Add getMatrixRoomInfo(roomId, opts)

---

## P1: Monitor Provider (src/matrix/monitor/)

### P1.15: Monitor Types
- [x] Create `src/matrix/monitor/types.ts` with MonitorMatrixOpts interface

### P1.16: Monitor Context
- [x] Create `src/matrix/monitor/context.ts` with createMatrixMonitorContext():
  - Client reference
  - Account config
  - Runtime (log, error, exit)
  - Bot user ID
  - AllowFrom rules
  - Channel histories
  - Dedupe cache

### P1.17: AllowFrom Filtering
- [x] Create `src/matrix/monitor/allow-list.ts` with:
  - normalizeMatrixAllowList(raw)
  - isMatrixUserAllowed(userId, allowFrom)
  - isMatrixRoomAllowed(roomId, config)
  - resolveMatrixRoomConfig(roomId, config)
  - resolveMatrixShouldRequireMention(roomConfig)

### P1.18: Event Handler Registration
- [x] Create `src/matrix/monitor/events/index.ts` with registerMatrixEvents()

### P1.19: Message Event Handler
- [x] Create `src/matrix/monitor/events/messages.ts` with:
  - Handle Room.timeline events
  - Filter m.room.message type
  - Skip historical messages (toStartOfTimeline)
  - Skip own messages (bot self-filter)
  - Non-blocking dispatch to agent
  - Handle message edits (m.replace) with system event
  - Handle redactions (message deletions) with system event

### P1.20: Reaction Event Handler
- [x] Create `src/matrix/monitor/events/reactions.ts` with:
  - Handle m.reaction events
  - Check reactionNotifications setting
  - Emit reaction notifications if enabled

### P1.21: Member Event Handler
- [x] Create `src/matrix/monitor/events/members.ts` with:
  - Handle m.room.member events
  - Track joins/leaves if needed

### P1.22: Room Event Handler
- [x] Create `src/matrix/monitor/events/rooms.ts` with:
  - Handle room invites
  - Handle room upgrades (tombstone)

### P1.23: Typing Event Handler (Optional)
- [x] Create `src/matrix/monitor/events/typing.ts` with registerMatrixTypingEvents()

### P1.24: Message Handler Factory
- [x] Create `src/matrix/monitor/message-handler/index.ts` with createMatrixMessageHandler()

### P1.25: Message Preflight
- [x] Create `src/matrix/monitor/message-handler/preflight.ts` with:
  - Check if sender is allowed (DM policy, allowFrom)
  - Check if room is allowed (room config)
  - Check for mention/trigger if required
  - Filter bot's own messages

### P1.26: Message Processing
- [ ] Create `src/matrix/monitor/message-handler/process.ts` with:
  - Extract message content (body, formatted_body)
  - Parse reply context if present
  - Build message event for session routing
  - Route to session via resolveAgentRoute()

### P1.27: Monitor Provider Entry Point
- [ ] Create `src/matrix/monitor/provider.ts` with monitorMatrixProvider():
  - Load config via resolveMatrixAccount()
  - Create Matrix client
  - Login (accessToken or password)
  - Create monitor context
  - Register event handlers
  - Start sync loop
  - Return cleanup handle

---

## P1: Channel Plugin Integration

### P1.28: Index Exports
- [ ] Create `src/matrix/index.ts` with all exports

### P1.29: Channel Plugin Definition
- [ ] Create `src/channels/plugins/matrix.ts` with matrixChannelPlugin:
  - id, meta
  - capabilities (chatTypes, reactions, threads, media)
  - config helpers (listAccountIds, resolveAccount, etc.)
  - security (resolveDmPolicy)
  - groups (resolveRequireMention)
  - threading (resolveReplyToMode)
  - messaging (normalizeTarget)
  - outbound (sendText, sendMedia)
  - status (probeAccount, buildAccountSnapshot)
  - gateway (startAccount)

### P1.30: Register Plugin
- [ ] Import matrixPlugin in `src/channels/plugins/index.ts`
- [ ] Add to resolveChannels() array

### P1.31: Channel Dock Integration
- [ ] Add Matrix entry to `src/channels/dock.ts` (if exists) for shared behavior

---

## P2: Testing

### P2.1: Unit Tests - Core
- [ ] Create `src/matrix/accounts.test.ts`
- [ ] Create `src/matrix/format.test.ts` - markdown/HTML conversion
- [ ] Create `src/matrix/token.test.ts`

### P2.2: Unit Tests - Actions
- [ ] Create `src/matrix/actions.test.ts` - action function tests

### P2.3: Unit Tests - Monitor
- [ ] Create `src/matrix/monitor/allow-list.test.ts` - allowFrom filtering
- [ ] Create `src/matrix/monitor/message-handler.test.ts` - message processing

### P2.4: Integration Tests
- [ ] Create `src/matrix/monitor.test.ts` - provider integration
- [ ] Test with local Synapse instance (manual verification)
- [ ] Test DM flow
- [ ] Test group room flow
- [ ] Test reactions
- [ ] Test message editing/deletion

---

## P2: Documentation & Onboarding

### P2.5: Channel Documentation
- [ ] Create `docs/channels/matrix.md`:
  - Overview and features
  - Config options reference
  - Setup steps (create bot account, get token)
  - Element client integration
  - Troubleshooting

### P2.6: Onboarding Adapter
- [ ] Create `src/channels/plugins/onboarding/matrix.ts` with matrixOnboardingAdapter
- [ ] Add Matrix option to onboarding wizard

### P2.7: Outbound Plugin
- [ ] Create `src/channels/plugins/outbound/matrix.ts` for CLI send support

### P2.8: Status Issues Handler
- [ ] Create `src/channels/plugins/status-issues/matrix.ts` if needed

---

## P2: E2EE Enhancement (Future)

### P2.9: E2EE Support (Deferred)
- [ ] Add @matrix-org/olm dependency
- [ ] Implement crypto store persistence
- [ ] Implement device verification flow
- [ ] Document E2EE setup requirements

---

## File Checklist

### New Files (26+ files)
- [ ] `src/matrix/index.ts`
- [x] `src/matrix/accounts.ts`
- [x] `src/matrix/actions.ts`
- [x] `src/matrix/client.ts`
- [x] `src/matrix/format.ts`
- [x] `src/matrix/probe.ts`
- [x] `src/matrix/send.ts`
- [x] `src/matrix/token.ts`
- [x] `src/matrix/types.ts`
- [x] `src/matrix/typing.ts`
- [ ] `src/matrix/monitor/provider.ts`
- [x] `src/matrix/monitor/allow-list.ts`
- [x] `src/matrix/monitor/context.ts`
- [x] `src/matrix/monitor/types.ts`
- [x] `src/matrix/monitor/events/index.ts`
- [x] `src/matrix/monitor/events/messages.ts`
- [x] `src/matrix/monitor/events/types.ts`
- [x] `src/matrix/monitor/room-config.ts`
- [x] `src/matrix/monitor/events/reactions.ts`
- [x] `src/matrix/monitor/events/members.ts`
- [x] `src/matrix/monitor/events/rooms.ts`
- [x] `src/matrix/monitor/events/typing.ts`
- [x] `src/matrix/monitor/message-handler/index.ts`
- [x] `src/matrix/monitor/message-handler/preflight.ts`
- [ ] `src/matrix/monitor/message-handler/process.ts`
- [ ] `src/channels/plugins/matrix.ts`
- [ ] `src/channels/plugins/onboarding/matrix.ts`
- [ ] `src/channels/plugins/outbound/matrix.ts`
- [ ] `docs/channels/matrix.md`

### Modified Files (5 files)
- [x] `package.json` - add matrix-js-sdk
- [x] `src/channels/registry.ts` - add "matrix" to order + meta
- [x] `src/config/zod-schema.providers-core.ts` - add Matrix schemas (MatrixRoomSchema, MatrixDmSchema, MatrixAccountSchema, MatrixConfigSchema)
- [x] `src/config/zod-schema.providers.ts` - add matrix to ChannelsSchema
- [ ] `src/channels/plugins/index.ts` - register matrix plugin

---

## Completed Tasks

- [x] P0.1: Add `matrix-js-sdk` to package.json dependencies (^34.0.0)
- [x] Add `dist/matrix/**` to package.json files array
- [x] P0.2: Channel Registry - add "matrix" to CHAT_CHANNEL_ORDER, CHAT_CHANNEL_META, CHAT_CHANNEL_ALIASES
- [x] P0.3: Create MatrixRoomSchema and MatrixDmSchema in `src/config/zod-schema.providers-core.ts`
- [x] P0.4: Create MatrixAccountSchema and MatrixConfigSchema in `src/config/zod-schema.providers-core.ts`
- [x] P0.5: Import MatrixConfigSchema and add matrix to ChannelsSchema in `src/config/zod-schema.providers.ts`
- [x] P1.1: Create `src/matrix/types.ts` with MatrixMessageEvent, MatrixActionOpts, MatrixRoomInfo, MatrixUserProfile, MatrixFile, MatrixMessageSummary types
- [x] P1.2: Create `src/matrix/token.ts` with resolveMatrixCredentials(), normalizeMatrixAccessToken(), normalizeMatrixPassword(), MatrixCredentials type
- [x] P1.3: Create `src/matrix/accounts.ts` with resolveMatrixAccount(), listMatrixAccountIds(), listEnabledMatrixAccounts(), resolveDefaultMatrixAccountId()
- [x] Create `src/config/types.matrix.ts` with MatrixAccountConfig, MatrixDmConfig, MatrixRoomConfig, MatrixActionConfig types
- [x] Add types.matrix.js export to `src/config/types.ts`
- [x] P1.4: Create `src/matrix/client.ts` with createMatrixClient(), loginMatrix(), startMatrixSync(), stopMatrixClient(), waitForMatrixClientStop(), getMatrixSyncState(), isMatrixClientSyncing()
- [x] P1.5: Create `src/matrix/format.ts` with markdownToMatrixHtml(), matrixHtmlToPlaintext(), formatMatrixReply(), extractMatrixMentions(), containsMatrixMention()
- [x] P1.6: Create `src/matrix/typing.ts` with sendMatrixTyping(), stopMatrixTyping()
- [x] P1.7: Create `src/matrix/send.ts` with sendMessageMatrix() - message chunking, markdown→HTML, reply threading, media attachments
- [x] P1.8: Create `src/matrix/probe.ts` with probeMatrix() - connection test, whoami verification, profile fetch
- [x] P1.9: Create `src/matrix/actions.ts` with getClient() helper and withClient() wrapper
- [x] P1.10: Add reaction actions - reactMatrixMessage, removeMatrixReaction, removeOwnMatrixReactions, listMatrixReactions
- [x] P1.11: Add message actions - sendMatrixMessage, editMatrixMessage, deleteMatrixMessage, readMatrixMessages
- [x] P1.12: Add sendMatrixReadReceipt for read receipts
- [x] P1.13: Add room management actions - joinMatrixRoom, leaveMatrixRoom, inviteToMatrixRoom
- [x] P1.14: Add user/room info actions - getMatrixUserProfile, getMatrixRoomMembers, getMatrixRoomInfo
- [x] P1.15: Create `src/matrix/monitor/types.ts` with MonitorMatrixOpts, MatrixReactionEvent, MatrixMemberEvent, MatrixRoomEvent, MatrixTypingEvent, MatrixRedactionEvent types
- [x] P1.16: Create `src/matrix/monitor/context.ts` with createMatrixMonitorContext() - client ref, account config, runtime, bot userId, allowFrom, room histories, dedupe cache, session key resolution, room/user info caching
- [x] P1.17: Create `src/matrix/monitor/allow-list.ts` with normalizeMatrixAllowList, isMatrixUserAllowed, isMatrixRoomAllowed, resolveMatrixRoomConfig, resolveMatrixShouldRequireMention, isMatrixRoomUserAllowed, shouldEmitMatrixReactionNotification, isMatrixRoomAllowedByPolicy
- [x] P1.18: Create `src/matrix/monitor/events/index.ts` with registerMatrixEvents() - central entry point for event registration, includes inline handlers for messages, reactions, members, and rooms following Slack pattern
- [x] P1.19: Create `src/matrix/monitor/events/messages.ts` with registerMatrixMessageEvents() - handles Room.timeline events, m.room.message filtering, historical message skipping, self-message filtering, non-blocking dispatch, edit handling with system events, redaction handling with system events. Also created `events/types.ts` for MatrixMessageHandler type and `room-config.ts` for resolveMatrixRoomLabel and resolveMatrixRoomConfig helpers.
- [x] P1.20: Create `src/matrix/monitor/events/reactions.ts` with registerMatrixReactionEvents() - handles m.reaction events via Room.timeline, filters by reactionNotifications mode (off/all/own/allowlist), emits system event notifications with actor display names, room labels, and proper session key routing. Updated events/index.ts to import from separate file.
- [x] P1.21: Create `src/matrix/monitor/events/members.ts` with registerMatrixMemberEvents() - handles RoomMemberEvent.Membership for membership changes (join, leave, ban, invite), bot invite detection, debug logging for membership transitions. Extracted from inline function in events/index.ts following the pattern of messages.ts and reactions.ts.
- [x] P1.22: Create `src/matrix/monitor/events/rooms.ts` with registerMatrixRoomEvents() - handles RoomStateEvent.Events for room tombstones (m.room.tombstone), room creation (m.room.create), alias changes (m.room.canonical_alias), and name changes (m.room.name). Extracted from inline function in events/index.ts following the pattern of messages.ts, reactions.ts, and members.ts.
- [x] P1.23: Create `src/matrix/monitor/events/typing.ts` with registerMatrixTypingEvents() - handles RoomMemberEvent.Typing for incoming typing indicators from other users, logs typing start/stop for debugging, filters out bot's own typing events. Updated events/index.ts to import and register typing handler.
- [x] P1.24: Create `src/matrix/monitor/message-handler/index.ts` with createMatrixMessageHandler() - factory function returning MatrixMessageHandler that runs preflight -> process pipeline, follows Discord/Slack pattern with non-blocking concurrent execution, errors caught and logged.
- [x] P1.25: Create `src/matrix/monitor/message-handler/preflight.ts` with preflightMatrixMessage() - validates incoming messages before processing: filters bot's own messages, checks DM policy/allowlist for DMs, checks room policy/allowlist for rooms, handles pairing for unauthorized DM senders, checks mention requirements, resolves agent route, records channel activity, builds history entries.

---

## Discovered Tasks

(Will be populated during implementation)

---

## Dependencies Graph

```
P0.1 (deps) ──────────────────────────────────────────┐
P0.2 (registry) ──────────────────────────────────────┤
P0.3-P0.5 (config) ───────────────────────────────────┤
                                                      ▼
                                               ┌──────────────┐
                                               │   P1 Core    │
                                               │  (parallel)  │
                                               └──────┬───────┘
                                                      │
        ┌──────────────┬──────────────┬───────────────┤
        ▼              ▼              ▼               ▼
   P1.1-P1.8     P1.9-P1.14     P1.15-P1.27     P1.28-P1.31
   (types,       (actions)      (monitor)       (plugin)
   client,
   send)
        │              │              │               │
        └──────────────┴──────────────┴───────────────┘
                                │
                                ▼
                         ┌──────────────┐
                         │      P2      │
                         │   (tests,    │
                         │   docs)      │
                         └──────────────┘
```

---

*Generated from PLAN.md on 2026-01-14*
*Last updated: 2026-01-13*
