# ThreadLink Wire Protocol

This document describes the actual protocol implemented by
`include/Protocol.h` / `src/Protocol.cpp` (framing) and
`src/Server.cpp` / `client.cpp` (message vocabulary). It is the
source of truth for anything speaking to the ThreadLink C++ server
over TCP — including the terminal client and, in Phase 2, the
WebSocket gateway.

If this document and the code ever disagree, the code wins; please
open a fix rather than trust stale prose.

---

## 1. Framing

Every message in either direction is sent as one length-prefixed
frame:

```
┌────────────────────────┬───────────────────────┐
│ 4-byte length (uint32)  │  payload (N bytes)    │
│ big-endian, network     │  arbitrary bytes,     │
│ byte order               │  UTF-8 text in practice│
└────────────────────────┴───────────────────────┘
```

- The length field is a `uint32_t` in **big-endian** byte order
  (`htonl`/`ntohl`), i.e. standard network byte order.
- The length field describes the size of the payload **only** — it
  does not include the 4-byte header itself.
- The payload has no terminator (no NUL, no newline required); its
  boundary is defined entirely by the declared length.
- A frame with `length == 0` is legal (empty payload) and is decoded
  as an empty string. The server currently never sends one and
  silently ignores one if a client sends it (see §4).

TCP is a byte stream, not a message stream: a single `recv()` may
return part of a frame, more than one frame, or a frame split across
a header/payload boundary. `send_all`/`recv_exact` in `Protocol.cpp`
loop until exactly the requested number of bytes has been
transferred (or the connection ends/errors), so callers of
`send_frame`/`recv_frame` never need to handle partial I/O
themselves. This is covered directly by
`tests/run_tests.py::test_fragmented_frame` (one byte at a time) and
`test_coalesced_frames` (two frames in a single `send()`).

### Maximum message size

- Default: `DEFAULT_MAX_MESSAGE_SIZE = 8192` bytes (`Protocol.h`).
- The server overrides this from `server.conf`'s `MAX_MESSAGE_SIZE`
  (see `docs/PROTOCOL.md` §5 / `Config.h`), and always passes the
  effective limit explicitly into `send_frame`/`recv_frame`.
- `recv_frame` checks the declared length **before** reading or
  allocating the payload. If it exceeds the limit, `recv_frame`
  returns `IoStatus::TooLarge` immediately without attempting to read
  the (potentially bogus or malicious) payload — this bounds memory
  use even against an adversarial peer that declares a huge length
  and sends nothing after it.
- The terminal client additionally enforces its own generous local
  cap (`CLIENT_MAX_MESSAGE_SIZE = 1 MiB` in `client.cpp`) as a sanity
  backstop; the server's configured limit is authoritative for what
  the server will actually accept.

### I/O status codes

`IoStatus` (`Protocol.h`) is the result of every framing operation:

| Value | Meaning |
|---|---|
| `Ok` | Completed successfully. |
| `ClosedByPeer` | Orderly disconnect — EOF while reading, or the peer closed the socket. Not an error; treat as a normal disconnect. |
| `Error` | A socket-level error (e.g. reset connection). Treat like a disconnect. |
| `TooLarge` | Declared (recv) or attempted (send) frame length exceeds the effective `max_size`. On receive, nothing beyond the 4-byte header was read. |

`send_all`/`recv_exact` retry on `EINTR` transparently and treat
`EAGAIN`/`EWOULDBLOCK` on send as "keep trying" (sockets here are
blocking, so this only matters for signal interruption in practice).

---

## 2. Connection lifecycle

1. Client opens a TCP connection to the server's configured port
   (`server.conf`'s `PORT`, default `8080`).
2. If the server is at `MAX_CLIENTS` capacity, it sends a single
   `ERR SERVER_FULL ...` frame and closes the connection — no
   `WELCOME` is sent in this case.
3. Otherwise, the server assigns a default nickname (`User1`,
   `User2`, ... — the lowest unused number) and sends exactly one
   `WELCOME <nickname>` frame. This is guaranteed to be the first
   frame the client ever receives: the server does not mark the
   client "welcomed" (eligible to receive broadcasts) or start its
   reader thread until after `WELCOME` has been written to the
   socket, so no other client's broadcast or this client's own
   command replies can arrive first.
4. The server then broadcasts `SYS <nickname> has joined.` to all
   other already-welcomed clients.
5. The client sends one line per frame — either plain chat text or a
   `/command` (see §3). The server replies/broadcasts as described
   per command.
6. The connection ends when: the client sends `/exit`, the client
   closes the socket, the socket errors, the client sends an
   oversized frame (server sends `ERR FRAME_TOO_LARGE ...` then
   closes), or the server shuts down.
7. On disconnect (any reason except `SERVER_FULL` rejection), the
   server broadcasts `SYS <nickname> has left.` to remaining clients.
8. On server shutdown (console `SHUTDOWN` command, `SIGINT`, or
   `SIGTERM`): the server broadcasts
   `SYS Server is shutting down. Goodbye!`, then half-shuts-down
   every client socket (`SHUT_RDWR`) to unblock any thread currently
   waiting in `recv_frame`, joins every client handler thread, and
   only then closes the listening socket and exits.

---

## 3. Client → server messages

Each frame's payload is one line of text with no trailing newline
required (the server strips a trailing `\r`/`\n` defensively if
present, but frames aren't newline-delimited — the framing layer
already gives exact message boundaries).

- **Plain text** (does not start with `/`): broadcast to every other
  welcomed client as `MSG <your-nickname> <text>` (see §4). Ignored
  silently if the line is empty after trimming.
- **`/nick <name>`** — change nickname. `<name>` must be 1–24
  characters, letters/digits/`_`/`-` only, no spaces (a name with an
  embedded space is rejected as `NICK_INVALID`, not truncated).
- **`/msg <name> <text>`** — send a private message to the client
  currently using nickname `<name>`. `<text>` may itself contain
  spaces (everything after the first space following `<name>`).
- **`/list`** — request the current online user list.
- **`/exit`** — client-initiated graceful disconnect.
- Any other `/word ...` — rejected with `ERR BAD_CMD ...`.

---

## 4. Server → client messages

All server messages are `<TYPE> <space-separated fields>`. Consumers
should split on the **first** space only to get `(type, rest)`, then
apply type-specific parsing to `rest` — several fields themselves may
contain spaces (e.g. chat text), so do not blindly split the whole
line.

| Type | Format | When |
|---|---|---|
| `WELCOME` | `WELCOME <nickname>` | Always the first frame after a successful connect; gives the client its assigned default nickname. |
| `SYS` | `SYS <free text>` | Join/leave/shutdown notices. Not machine-parseable beyond the `SYS` prefix — treat `<free text>` as a display string. |
| `MSG` | `MSG <sender> <text>` | Public chat broadcast, sent to every welcomed client except the sender. |
| `PRIV` | `PRIV <sender> <text>` | Delivered to the *recipient* of a `/msg`. |
| `PRIV_SENT` | `PRIV_SENT <recipient> <text>` | Delivered back to the *sender* of a `/msg`, confirming what was sent and to whom. |
| `NICK` | `NICK <old> <new>` | Broadcast to **all** welcomed clients (including the one who changed) whenever any nickname changes. |
| `LIST` | `LIST <count> <name1> <name2> ...` | Response to `/list`. Names are space-separated and alphabetically sorted; only welcomed clients are included. `<count>` is authoritative — do not infer it from splitting, since names are also space-separated from each other. |
| `ERR` | `ERR <code> <free text>` | See error codes below. `<free text>` is for display; branch logic on `<code>`. |

### Error codes (`ERR <code> ...`)

| Code | Meaning |
|---|---|
| `SERVER_FULL` | Sent instead of `WELCOME`; connection is about to be closed. |
| `FRAME_TOO_LARGE` | A received frame declared a length over the server's `MAX_MESSAGE_SIZE`; connection is about to be closed. |
| `BAD_CMD` | Unrecognized `/command`. |
| `NICK_EMPTY` | `/nick` with no argument. |
| `NICK_INVALID` | Nickname failed length/character validation, or contained a space. |
| `NICK_TAKEN` | Requested nickname is already in use by another connected client. |
| `MSG_USAGE` | `/msg` missing target and/or text. |
| `USER_NOT_FOUND` | `/msg` target nickname isn't currently connected. |
| `MSG_SELF` | `/msg` target resolved to the sender's own connection. |

---

## 5. Configuration (`server.conf`)

Loaded once at startup by `Config::load_config`. Unknown keys are
warned about and ignored; missing or invalid values fall back to a
built-in default and log a warning (never fatal).

| Key | Default | Valid range | Notes |
|---|---|---|---|
| `PORT` | `8080` | `1`–`65535` | TCP listen port. |
| `MAX_CLIENTS` | `100` | `1`–`10000` | Simultaneous connections; further connections get `ERR SERVER_FULL`. |
| `MAX_MESSAGE_SIZE` | `8192` | `64`–`16777216` (16 MiB) | Effective frame payload cap, enforced on both send and receive. |
| `LOG_LEVEL` | `INFO` | `DEBUG` / `INFO` / `WARN` / `ERROR` | Case-insensitive; unrecognized values keep the current level and log a warning. |

---

## 6. Assumptions and non-goals (Phase 1)

These are deliberate, not oversights — later phases may revisit them:

- **No authentication.** Any TCP client can connect and claim any
  free nickname. Phase 5.
- **No persistence.** Message/user state lives only in server
  memory and is lost on restart. Phase 4.
- **Flat namespace, no conversations.** The server has exactly one
  public room plus ad-hoc 1:1 `/msg`; there is no group/channel
  concept, membership model, or per-conversation history. Phase 3.
- **Nicknames are the only identity.** There is no stable user ID
  independent of the currently-chosen nickname; changing nickname is
  changing identity as far as the protocol is concerned.
- **IPv4 only** (`AF_INET`); no IPv6 listener.
- **Text payloads are not validated as UTF-8** — the server treats
  payloads as opaque byte strings and only imposes structural rules
  on the token immediately after `/nick`/`/msg`/etc.
