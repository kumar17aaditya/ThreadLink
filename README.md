# ThreadLink 🚀
### A Real-Time Chat Platform, Built on a Production-Grade C++ Networking Core

[![C++](https://img.shields.io/badge/C%2B%2B-17-blue)]()
[![Platform](https://img.shields.io/badge/Platform-Linux-green)]()
[![Build](https://img.shields.io/badge/Build-Make-orange)]()
[![Sanitizers](https://img.shields.io/badge/Sanitizers-ASan%20%7C%20UBSan%20%7C%20TSan-brightgreen)]()

ThreadLink started as a small multi-threaded TCP chat server in
**C++17** and is evolving into a full real-time chat platform:

```text
Next.js Frontend  ──WebSocket──▶  Node.js/TypeScript Gateway  ──TCP──▶  C++ ThreadLink Server
```

The C++ backend is the core real-time networking engine and the part
of the project this README focuses on. The gateway and frontend
layers are documented in `frontend/`.

---

# ✨ What the backend actually does

- Multi-threaded server, thread-per-client, `select()`-based accept
  loop with clean shutdown on `SIGINT`/`SIGTERM`/console `SHUTDOWN`.
- **Length-prefixed binary framing** over TCP — not raw text — so
  messages can never be corrupted by TCP coalescing or fragmentation.
  See [`docs/PROTOCOL.md`](docs/PROTOCOL.md) for the full wire format.
- RAII socket ownership (`include/Socket.h`); no bare `int` fd
  juggling in the server logic.
- Per-client write mutexes, so one slow/stuck client can't stall
  broadcasts to everyone else.
- Validated, defaulted configuration (`server.conf`): `PORT`,
  `MAX_CLIENTS`, `MAX_MESSAGE_SIZE`, `LOG_LEVEL`.
- Structured, leveled, thread-safe logging (`DEBUG`/`INFO`/`WARN`/`ERROR`).
- Public broadcast chat, private 1:1 messaging, dynamic nicknames
  with collision detection, online user listing, graceful shutdown
  that drains and notifies every connected client.
- A real integration test suite (`tests/run_tests.py`) covering
  connection lifecycle, framing edge cases (fragmented and coalesced
  frames), malformed/oversized input, concurrency, and shutdown —
  and it's validated clean under **AddressSanitizer**,
  **UndefinedBehaviorSanitizer**, and **ThreadSanitizer**.

---

# 🏗️ Architecture

```text
                  +----------------+
                  |     Server     |
                  | (TCP Socket)   |
                  +----------------+
                   /      |      \
                  /       |       \
                 /        |        \
        +---------+ +---------+ +---------+
        | Client1 | | Client2 | | Client3 |
        +---------+ +---------+ +---------+
```

Each incoming connection spawns a dedicated thread:

```text
New Connection
      |
      v
accept()
      |
      v
Assign nickname, send WELCOME
      |
      v
Spawn handler thread
      |
      v
Loop: recv_frame() -> handle_line() -> broadcast/reply
```

Shared client state (`fd -> {nickname, write_mutex}`) lives behind a
single mutex; actual `send()` calls always happen outside that lock,
holding only the target client's own write mutex, so no client can
block another.

---

# 🧠 Concepts Demonstrated

## Networking & Protocol Design
- TCP/IP, client-server architecture, socket programming
- Custom length-prefixed binary framing (see `docs/PROTOCOL.md`)
- Partial send/recv handling, `EINTR` retry, malicious/oversized
  frame rejection without allocating

## Linux System Programming
- `socket()`, `bind()`, `listen()`, `accept()`, `connect()`,
  `send()`, `recv()`, `close()`, `select()`, `shutdown()`

## Concurrency
- `std::thread`, `std::mutex`, `std::atomic`, `std::lock_guard`
- Thread-per-client architecture with careful shutdown ordering to
  avoid races between a just-spawned client thread and a
  broadcast-in-progress
- Verified with ThreadSanitizer, not just "should be fine"

## Resource Management
- RAII socket wrapper (move-only, closes exactly once)
- No manual `delete`/leak-prone ownership

## Object-Oriented / Modular Design
- Protocol, config, logging, and server logic are separate,
  independently testable units

---

# 📂 Project Structure

```text
ThreadLink/
├── include/
│   ├── Config.h        # server.conf loading + validation
│   ├── Log.h            # leveled structured logging
│   ├── Protocol.h        # framing (length-prefixed I/O)
│   ├── Server.h          # server class
│   └── Socket.h          # RAII fd wrapper
├── src/
│   ├── Config.cpp
│   ├── Log.cpp
│   ├── Protocol.cpp
│   ├── Server.cpp
│   └── main.cpp
├── client.cpp             # terminal client
├── tests/
│   └── run_tests.py       # integration test suite
├── docs/
│   └── PROTOCOL.md        # wire protocol reference
├── frontend/               # Next.js web client (see frontend/README.md)
├── makefile
├── server.conf
└── README.md
```

---

# ⚙️ Prerequisites

- Linux
- g++ (C++17 or later)
- GNU Make
- Python 3 (to run the integration test suite)
- Node.js 18+ (only needed for the `frontend/` app)

### Ubuntu/Debian

```bash
sudo apt install build-essential python3
```

---

# 🔨 Build

```bash
make            # optimized release build (default target)
make release    # same as above, explicit
make debug      # -O0 -g, AddressSanitizer + UndefinedBehaviorSanitizer
make tsan       # -O1 -g, ThreadSanitizer (separate target: ASan and TSan
                # can't be linked into the same binary)
make clean
```

All targets produce `server` and `client` in the repo root.

---

# 🚀 Running

### Start the server

```bash
./server
```

```text
[INFO] ThreadLink server listening on port 8080 (max_clients=100, max_message_size=8192 bytes)
[INFO] Type SHUTDOWN and press Enter, or send SIGINT/SIGTERM, to stop the server.
```

### Start one or more clients

```bash
./client                  # connects to 127.0.0.1:8080
./client <host> <port>    # or specify explicitly
```

---

# 💬 Client Commands

| Command | Description |
|---------|-------------|
| `/nick <name>` | Change nickname |
| `/msg <user> <message>` | Send a private message |
| `/list` | List connected users |
| `/exit` | Disconnect |

Full server→client message vocabulary (`WELCOME`, `SYS`, `MSG`,
`PRIV`, `NICK`, `LIST`, `ERR ...`) and error codes are documented in
[`docs/PROTOCOL.md`](docs/PROTOCOL.md).

---

# ⚙️ Configuration (`server.conf`)

```text
PORT=8080
MAX_CLIENTS=100
MAX_MESSAGE_SIZE=8192
LOG_LEVEL=INFO
```

Missing or invalid values fall back to safe defaults and log a
warning — the server never fails to start over a bad config file.
See `docs/PROTOCOL.md` §5 for valid ranges.

---

# 🧪 Tests

```bash
make debug
python3 tests/run_tests.py "$(pwd)/server"
```

Covers: connection/welcome, nickname changes and broadcast,
duplicate-nickname rejection, invalid nicknames, malformed commands,
private messaging, fragmented and coalesced frame handling, oversized
frame rejection, disconnect notification, `/exit`, multi-client
`/list`, server-full rejection, and graceful shutdown.

For a race-detection pass instead of memory-safety:

```bash
make tsan
python3 tests/run_tests.py "$(pwd)/server"
```

---

# 🛠️ Technologies Used

**Backend:** C++17, POSIX Sockets, Linux System Programming, Multithreading, TCP/IP, GNU Make, ASan/UBSan/TSan
**Web layer (in progress):** Node.js, TypeScript, WebSockets, Next.js, React, Tailwind

---

# 🛣️ Roadmap

- [x] **Phase 1** — Production-grade C++ backend (framing, RAII, config, logging, tests, sanitizers)
- [ ] **Phase 2** — WebSocket gateway + connected web application
- [ ] **Phase 3** — Users, presence, conversations, DMs, group chats
- [ ] Phase 4+ — Persistence, auth, invites, advanced messaging, deployment (future work, out of current scope)

---

# 👨‍💻 Connect

- GitHub: https://github.com/kumar17aaditya
- LinkedIn: https://www.linkedin.com/in/aditya-kumar-82a292251/

---

⭐ If you found this project interesting, consider giving it a star!
