---
summary: "Matrix bot support status, capabilities, and configuration"
read_when:
  - Working on Matrix channel features
  - Setting up Matrix or Element integration
---
# Matrix (Bot API)

Status: ready for DM and room messaging via the official Matrix protocol using `matrix-js-sdk`.

## Quick setup (beginner)
1) Create a Matrix bot account on your homeserver (or use an existing account).
2) Get an access token for the bot account.
3) Set the token and homeserver for Clawdbot:
   - Env: `MATRIX_ACCESS_TOKEN=...`
   - Or config: `channels.matrix.accessToken: "..."`.
4) Start the gateway.
5) DM access is pairing by default; approve the pairing code on first contact.

Minimal config:
```json5
{
  channels: {
    matrix: {
      enabled: true,
      homeserver: "https://matrix.example.org",
      userId: "@bot:example.org",
      accessToken: "syt_..."
    }
  }
}
```

## Goals
- Talk to Clawdbot via Matrix DMs or rooms using any Matrix client (Element, FluffyChat, etc.).
- Direct chats collapse into the agent's main session (default `agent:main:main`); rooms stay isolated as `agent:<agentId>:matrix:room:<roomId>`.
- Keep routing deterministic: replies always go back to the room/DM they arrived on.

## How it works
1. Create a Matrix account for your bot on your homeserver (or use an existing one).
2. Generate an access token for the bot (see "Getting an access token" below).
3. Configure Clawdbot with the homeserver URL, user ID, and access token.
4. Run the gateway; it auto-starts the Matrix channel when credentials are available (env or config) and `channels.matrix.enabled` is not `false`.
5. Direct chats: all turns land in the shared `main` session.
6. Rooms: use `room:<roomId>` for delivery. Mentions are required by default and can be set per room.
7. Direct chats: secure by default via `channels.matrix.dm.policy` (default: `"pairing"`). Unknown senders get a pairing code (expires after 1 hour); approve via `clawdbot pairing approve matrix <code>`.
   - To keep old "open to anyone" behavior: set `channels.matrix.dm.policy="open"` and `channels.matrix.dm.allowFrom=["*"]`.
   - To hard-allowlist: set `channels.matrix.dm.policy="allowlist"` and list senders in `channels.matrix.dm.allowFrom`.
   - To ignore all DMs: set `channels.matrix.dm.enabled=false`.
8. Optional room rules: set `channels.matrix.rooms` keyed by room ID, with per-room rules.
9. Reactions: the agent can trigger reactions via Matrix actions (gated by `channels.matrix.actions.*`).
10. Room context `[from:]` lines include the sender's Matrix user ID and display name.

## Getting an access token

### Option 1: Using Element Web
1. Log in to Element Web with your bot account.
2. Open **Settings** > **Help & About**.
3. Scroll down and click **Access Token** to reveal it.
4. Copy the token (treat it like a password).

### Option 2: Using curl (password login)
```bash
curl -XPOST \
  -d '{"type":"m.login.password","user":"@bot:example.org","password":"yourpassword"}' \
  "https://matrix.example.org/_matrix/client/r0/login"
```

The response includes an `access_token` field.

### Option 3: Using the Matrix client SDK
Use any Matrix SDK to perform a password login and extract the access token from the response.

Note: Store the token securely. If compromised, regenerate it by logging out all sessions and logging in again.

## Clawdbot config

### Token
Set the access token via env var (recommended on servers):
- `MATRIX_ACCESS_TOKEN=syt_...`
- `MATRIX_PASSWORD=...` (alternative: password-based login)

Or via config:

```json5
{
  channels: {
    matrix: {
      enabled: true,
      homeserver: "https://matrix.example.org",
      userId: "@bot:example.org",
      accessToken: "syt_..."
    }
  }
}
```

Multi-account support: use `channels.matrix.accounts` with per-account credentials and optional `name`. See [`gateway/configuration`](/gateway/configuration#telegramaccounts--discordaccounts--slackaccounts--signalaccounts--imessageaccounts) for the shared pattern.

### Allowlist + room routing
Example "only allow specific users, only allow specific room":

```json5
{
  channels: {
    matrix: {
      enabled: true,
      homeserver: "https://matrix.example.org",
      userId: "@bot:example.org",
      accessToken: "syt_...",
      dm: { enabled: false },
      groupPolicy: "allowlist",
      rooms: {
        "!abc123:example.org": {
          allow: true,
          requireMention: true,
          users: ["@alice:example.org", "@bob:example.org"]
        }
      }
    }
  }
}
```

Notes:
- `requireMention: true` means the bot only replies when mentioned (recommended for shared rooms).
- `agents.list[].groupChat.mentionPatterns` (or `messages.groupChat.mentionPatterns`) also count as mentions for room messages.
- If `rooms` is present with `groupPolicy: "allowlist"`, any room not listed is denied by default.

### Verify it works
1. Start the gateway.
2. In a Matrix room with the bot, send: `@bot:example.org hello` (using your bot's user ID).
3. If nothing happens: check **Troubleshooting** below.

## Troubleshooting
- First: run `clawdbot doctor` and `clawdbot channels status --probe` (actionable warnings + quick audits).
- **Bot connects but never replies in a room**:
  - The bot hasn't joined the room (invite it first), or
  - Your config requires mentions and you didn't mention it, or
  - Your room allowlist denies the room/user.
- **`requireMention: false` but still no replies**:
  - `channels.matrix.groupPolicy` defaults to **allowlist**; set it to `"open"` or explicitly list rooms under `channels.matrix.rooms`.
- **DMs don't work**: `channels.matrix.dm.enabled=false`, or you haven't been approved yet (`channels.matrix.dm.policy="pairing"`).
- **Authentication failures**: verify your access token is valid and hasn't expired. Try regenerating it.
- **Homeserver connection errors**: verify the homeserver URL is correct and accessible.

## Capabilities & limits
- DMs and room text messages (threads are treated as replies; voice/video not supported).
- Typing indicators sent best-effort during processing.
- Message chunking uses `channels.matrix.textChunkLimit` (default 4000).
- File uploads supported up to the configured `channels.matrix.mediaMaxMb` (default 10 MB).
- Mention-gated room replies by default to avoid noisy bots.
- Reply context is injected when a message is a reply (quoted content + event IDs).
- Native reply threading is **off by default**; enable with `channels.matrix.replyToMode`.

## Config

```json5
{
  channels: {
    matrix: {
      enabled: true,
      homeserver: "https://matrix.example.org",
      userId: "@bot:example.org",
      accessToken: "syt_...",
      // deviceId: "CLAWDBOT01",  // optional, for session persistence
      groupPolicy: "allowlist",
      dm: {
        enabled: true,
        policy: "pairing",  // pairing | allowlist | open
        allowFrom: ["@alice:example.org", "@bob:example.org"]
      },
      rooms: {
        "!abc123:example.org": {
          allow: true,
          requireMention: true,
          users: ["@alice:example.org"],
          skills: ["search", "docs"],
          systemPrompt: "Keep answers short."
        },
        "!def456:example.org": {
          allow: true,
          requireMention: false
        }
      },
      historyLimit: 20,
      dmHistoryLimit: 50,
      textChunkLimit: 4000,
      mediaMaxMb: 10,
      replyToMode: "off",
      reactionNotifications: "own",
      reactionAllowlist: ["@alice:example.org"],
      actions: {
        reactions: true,
        messages: true,
        read: true,
        pins: true,
        memberInfo: true,
        roomInfo: true
      }
    }
  }
}
```

Ack reactions are controlled globally via `messages.ackReaction` +
`messages.ackReactionScope`. Use `messages.removeAckAfterReply` to clear the
ack reaction after the bot replies.

### Config options

- `homeserver`: Matrix homeserver URL (required).
- `userId`: Bot's Matrix user ID like `@bot:example.org` (required).
- `accessToken`: Access token for authentication.
- `password`: Alternative to accessToken; used for password-based login.
- `deviceId`: Optional device ID for session persistence across restarts.
- `dm.enabled`: set `false` to ignore all DMs (default `true`).
- `dm.policy`: DM access control (`pairing` recommended). `"open"` requires `dm.allowFrom=["*"]`.
- `dm.allowFrom`: DM allowlist (user IDs). Used by `dm.policy="allowlist"` and for `dm.policy="open"` validation.
- `groupPolicy`: controls room handling (`open|disabled|allowlist`); `allowlist` requires room allowlists.
- `rooms`: per-room rules keyed by room ID.
- `rooms.<id>.allow`: allow/deny the room when `groupPolicy="allowlist"`.
- `rooms.<id>.requireMention`: mention gating for the room.
- `rooms.<id>.users`: optional per-room user allowlist (Matrix user IDs).
- `rooms.<id>.skills`: skill filter (omit = all skills, empty = none).
- `rooms.<id>.systemPrompt`: extra system prompt for the room.
- `rooms.<id>.enabled`: set `false` to disable the room.
- `historyLimit`: number of recent room messages to include as context when replying (default 20; `0` disables).
- `dmHistoryLimit`: number of recent DM messages to include as context (default 50; `0` disables).
- `textChunkLimit`: outbound text chunk size (chars). Default: 4000.
- `mediaMaxMb`: max inbound media size saved to disk. Default: 10.
- `replyToMode`: `off` (default), `first`, or `all`. Controls automatic reply threading.
- `reactionNotifications`: reaction system event mode (`off`, `own`, `all`, `allowlist`).
- `reactionAllowlist`: user IDs whose reactions trigger notifications (when mode is `allowlist`).
- `actions`: per-action tool gates; omit to allow all (set `false` to disable).
  - `reactions` (add/remove/list reactions)
  - `messages` (read/send/edit/delete)
  - `read` (mark as read)
  - `pins` (pin/unpin)
  - `memberInfo` (room member info)
  - `roomInfo` (room details)

### Reaction notifications

Use `channels.matrix.reactionNotifications`:
- `off`: no reaction events.
- `own`: reactions on the bot's own messages (default).
- `all`: all reactions on all messages.
- `allowlist`: reactions from users in `reactionAllowlist` on all messages.

### Tool action defaults

| Action group | Default | Notes |
| --- | --- | --- |
| reactions | enabled | Add/remove/list reactions |
| messages | enabled | Read/send/edit/delete |
| read | enabled | Mark messages as read |
| pins | enabled | Pin/unpin messages |
| memberInfo | enabled | Room member info |
| roomInfo | enabled | Room details |

## Reply tags
To request a threaded reply, the model can include one tag in its output:
- `[[reply_to_current]]` — reply to the triggering Matrix message.
- `[[reply_to:<eventId>]]` — reply to a specific event ID from context/history.

Behavior is controlled by `channels.matrix.replyToMode`:
- `off`: ignore tags.
- `first`: only the first outbound chunk/attachment is a reply.
- `all`: every outbound chunk/attachment is a reply.

## Delivery targets
Use these with cron/CLI sends:
- `user:<userId>` for DMs (e.g., `user:@alice:example.org`)
- `room:<roomId>` for rooms (e.g., `room:!abc123:example.org`)

## Sessions + routing
- DMs share the `main` session (like WhatsApp/Telegram).
- Rooms map to `agent:<agentId>:matrix:room:<roomId>` sessions.

## Allowlist matching notes
- `allowFrom`/`users` accept Matrix user IDs like `@alice:example.org`.
- Use `*` to allow any sender.
- When `rooms` is present with `groupPolicy: "allowlist"`, rooms not listed are denied by default.

## E2EE (Encryption)
End-to-end encryption (E2EE) is not yet supported. The bot will only work in unencrypted rooms and DMs. E2EE support is planned for a future release.

## Safety & ops
- Treat the access token like a password; prefer the `MATRIX_ACCESS_TOKEN` env var on supervised hosts or lock down the config file permissions.
- Only join rooms the bot needs to be in.
- If the bot is stuck, restart the gateway (`clawdbot gateway --force`).
