# ThreadLink Gateway Protocol (Browser ↔ Gateway)

This documents the JSON WebSocket protocol between the browser and the
Node/TypeScript gateway (`gateway/`). It is the authoritative contract
— keep `frontend/types/protocol.ts` and `gateway/src/clientProtocol.ts`
in sync with this document.

This is a **separate** protocol from the C++ backend's own
length-prefixed text protocol (`docs/PROTOCOL.md`). The browser never
speaks the backend protocol directly; the gateway translates between
the two.

```
Browser  <--- JSON over WebSocket --->  Gateway  <--- framed text over TCP --->  C++ Server
```

---

## 1. Connection lifecycle

1. Browser opens a WebSocket connection to the gateway
   (`ws://host:8081` by default).
2. The gateway immediately opens its own dedicated TCP connection to
   the C++ backend for this session and waits for `WELCOME`.
   - If the backend can't be reached at all, the gateway sends a
     single `error` message with code `BACKEND_UNAVAILABLE` and closes
     the WebSocket.
3. Once the backend has welcomed the session, the gateway sends
   exactly one `ready` message — this is the browser's signal that the
   session is live and it's safe to send messages. Any client messages
   sent before `ready` are queued by the gateway and replayed once
   ready, so a client doesn't strictly have to wait, but should expect
   no responses until `ready` arrives.
4. Every other online user is notified of the new user via
   `userUpdate`.
5. The browser may send `setNickname` at any time to claim/change its
   display name (this proxies to the backend's own uniqueness- and
   format-validated `/nick`, so errors come back as real backend error
   codes — see §4).
6. On disconnect (browser closes the tab/socket, or the backend
   connection is lost), the gateway removes the session and broadcasts
   `userOffline` to everyone else. **There is no session continuity
   across reconnects** — a reconnect is a brand-new WebSocket, gets a
   brand-new `userId`, and (if the backend has capacity) a fresh
   backend-assigned default nickname until/unless `setNickname` is
   sent again. This is a deliberate scope boundary: real user
   continuity across reconnects needs persistent accounts, which is
   Phase 4/5, not this phase.

---

## 2. Identity and presence model

- `userId` is a **gateway-issued** UUID, stable for the lifetime of
  one WebSocket connection. It is intentionally independent of the
  backend nickname (which can change mid-session) — this gives
  Phase 3 real, stable user identity instead of reusing "nickname" as
  the identity key the way the raw backend protocol does.
- `presence` is one of:
  - `"online"` — the session has an active, welcomed backend
    connection. Grounded in real connection state.
  - `"away"` — the client explicitly said so via `setPresence`. Real,
    broadcast in real time; not a frontend-only decoration.
  - `"offline"` — implicit: the user is absent from the roster
    entirely (see `userOffline` below) once their session ends. There
    is no explicit "offline" `userUpdate`; the *absence* of a user, or
    a `userOffline` event, is how a client learns someone left.

---

## 3. Conversations

Three kinds, described by `ConversationSummary`:

| Kind | `id` format | Notes |
|---|---|---|
| `public` | always `"public"` | One global room. Backed directly by the C++ server's broadcast (`MSG`). Every online user is implicitly a member. |
| `direct` | `"direct:<idA>:<idB>"` (ids sorted) | 1:1. Backed directly by the C++ server's private-message mechanism (`/msg`, `PRIV`/`PRIV_SENT`), addressed by the peer's *current* nickname at send time. Created lazily on first message, or eagerly if you already know the peer's `userId`. |
| `group` | `"group:<uuid>"` | Multi-member. **Not** backed by the C++ server (it has no group primitive — see `docs/PROTOCOL.md` §6) — group membership and message fan-out are real, gateway-owned application state, delivered directly over each member's own live WebSocket session. Membership is enforced server-side; a non-member can never receive a group's messages (see `gateway/tests/e2e.test.ts`). |

`conversationCreated` is sent to every affected member when a new
direct or group conversation comes into existence (first DM to a new
peer, or being added to a new group).

---

## 4. Client → Gateway messages

All messages are JSON objects with a `type` field. Unknown/malformed
messages get a `error` response (see §5) rather than being silently
dropped or crashing the connection.

### `setNickname`
```json
{ "type": "setNickname", "nickname": "alice" }
```
1–24 characters. Validated by the gateway for shape (non-empty,
length) and by the **backend** for uniqueness/character rules — a
rejection surfaces as `error` with the backend's own code
(`NICK_TAKEN`, `NICK_INVALID`, `NICK_EMPTY`).

### `sendMessage`
```json
{ "type": "sendMessage", "target": { "kind": "public" }, "text": "hello" }
{ "type": "sendMessage", "target": { "kind": "direct", "peerId": "<userId>" }, "text": "hi" }
{ "type": "sendMessage", "target": { "kind": "group", "groupId": "group:<uuid>" }, "text": "hi team" }
```
`text`: 1–4000 characters.

### `createGroup`
```json
{ "type": "createGroup", "name": "Engineering", "memberIds": ["<userId>", "<userId>"] }
```
The creator is added automatically; `memberIds` need not include
them. All ids must belong to currently-online users, or the request is
rejected with `UNKNOWN_MEMBER`.

### `setPresence`
```json
{ "type": "setPresence", "presence": "online" }
{ "type": "setPresence", "presence": "away" }
```
`"offline"` is not settable by the client — it's implied by
disconnecting.

### `requestState`
```json
{ "type": "requestState" }
```
Asks the gateway to resend a full `ready` snapshot (current roster +
this user's conversations). Useful after reconnecting or recovering
from a missed-message suspicion.

---

## 5. Gateway → Client messages

### `ready`
Sent once per session, right after the backend welcomes it.
```json
{
  "type": "ready",
  "userId": "b0b7...",
  "username": "User3",
  "users": [{ "id": "...", "username": "...", "presence": "online" }],
  "conversations": [{ "id": "public", "kind": "public", "title": "Public Chat", "memberIds": [...] }]
}
```

### `userUpdate`
Sent whenever a user comes online, changes nickname, or changes
presence.
```json
{ "type": "userUpdate", "user": { "id": "...", "username": "...", "presence": "away" } }
```

### `userOffline`
```json
{ "type": "userOffline", "userId": "..." }
```

### `conversationCreated`
```json
{ "type": "conversationCreated", "conversation": { "id": "...", "kind": "group", "title": "...", "memberIds": [...] } }
```

### `message`
```json
{
  "type": "message",
  "message": {
    "id": "...",
    "conversationId": "public",
    "kind": "chat",
    "senderId": "...",
    "senderUsername": "alice",
    "text": "hello",
    "timestamp": "2026-08-08T09:00:00.000Z"
  }
}
```
`senderId` can be `null` for a `msg`/`priv` event whose sender left
between sending and this gateway processing the backend broadcast — a
narrow race that display code should treat as "unknown sender",
falling back to `senderUsername`.

### `error`
```json
{ "type": "error", "code": "USER_NOT_FOUND", "message": "That user is not currently online." }
```
`conversationId` is included where relevant (e.g. a failed DM send).
Codes either come straight from the backend (`docs/PROTOCOL.md` §4 —
`NICK_TAKEN`, `NICK_INVALID`, `NICK_EMPTY`, `BAD_CMD`, `MSG_SELF`) or
are gateway-native: `BACKEND_UNAVAILABLE`, `BACKEND_DISCONNECTED`,
`MESSAGE_TOO_LARGE`, `BAD_JSON`, `BAD_MESSAGE`, `UNKNOWN_MEMBER`,
`NOT_A_MEMBER`, `USER_NOT_FOUND`.

---

## 6. Limits

| Limit | Default | Configurable via |
|---|---|---|
| Max WebSocket message size | 16 KiB | `MAX_CLIENT_MESSAGE_BYTES` |
| Max chat text length | 4000 chars | fixed |
| Max nickname length | 24 chars | fixed (mirrors backend) |
| Max group name length | 48 chars | fixed |
| Max group members per `createGroup` call | 64 | fixed |
| Backend frame size the gateway will forward | 8192 bytes | `BACKEND_MAX_MESSAGE_BYTES`, must match the backend's own `server.conf` `MAX_MESSAGE_SIZE` |

---

## 7. Known scope boundaries (by design, not oversight)

- No persistence: restart the gateway or backend and all
  users/conversations/history are gone. Phase 4.
- No authentication: any WebSocket client can claim any free
  nickname. Phase 5.
- No message history backfill on `ready`/`conversationCreated` — a
  client only sees messages sent while it's connected.
- Group membership does not survive a member's disconnect/reconnect
  (see §1) since there's no persistent identity to re-attach to yet.
