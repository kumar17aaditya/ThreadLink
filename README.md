# ThreadLink 🚀
### A Real-Time Chat Platform, Built on a Production-Grade C++ Networking Core

[![C++](https://img.shields.io/badge/C%2B%2B-17-blue)]()
[![Platform](https://img.shields.io/badge/Platform-Linux-green)]()
[![Build](https://img.shields.io/badge/Build-Make-orange)]()
[![Sanitizers](https://img.shields.io/badge/Sanitizers-ASan%20%7C%20UBSan%20%7C%20TSan-brightgreen)]()
[![Gateway](https://img.shields.io/badge/Gateway-Node%20%2F%20TypeScript-3178c6)]()
[![Frontend](https://img.shields.io/badge/Frontend-Next.js%20%2F%20React-black)]()

ThreadLink started as a small multi-threaded TCP chat server in
**C++17** and is now a full three-tier real-time chat platform:

```text
Next.js Frontend  ──WebSocket──▶  Node.js/TypeScript Gateway  ──TCP──▶  C++ ThreadLink Server
   (browser)                        (gateway/)                            (root)
```

- **C++ backend** (repo root) — the real-time networking engine: framed TCP,
  thread-per-client concurrency, nickname/broadcast/private-message primitives.
- **Gateway** (`gateway/`) — a thin Node/TypeScript bridge. Translates
  browser WebSocket JSON into the backend's TCP protocol and back, and
  owns the application-layer concepts the backend doesn't have: stable
  user identity, presence, conversations, and group chat.
- **Frontend** (`frontend/`) — a Next.js/React web client with a
  distinctive, dark-first ThreadLink UI: public chat, direct messages,
  group chats, presence, and connection-state handling.

All three tiers are implemented, tested, and validated end-to-end.
See [Status](#-status) below for exactly what that means.

---

# ✨ Features

**Backend (C++)**
- Multi-threaded, thread-per-client, `select()`-based accept loop;
  clean shutdown on `SIGINT`/`SIGTERM`/console `SHUTDOWN`
- Length-prefixed binary framing over TCP (`docs/PROTOCOL.md`) — immune
  to TCP coalescing/fragmentation corruption
- RAII socket ownership, per-client write mutexes (a slow client can't
  stall broadcasts to everyone else), validated configuration,
  structured leveled logging
- Public broadcast chat, private 1:1 messaging, dynamic nicknames with
  collision detection, graceful shutdown that drains every client

**Gateway (Node/TypeScript)**
- One dedicated backend TCP connection per browser session — reuses
  the C++ server's own nickname/broadcast/private-message engine
  rather than reimplementing it
- Real, gateway-owned application state: stable user identity
  (independent of nickname), presence (`online`/`away`/`offline`),
  and conversation membership/routing (`docs/GATEWAY_PROTOCOL.md`)
- Public chat and DMs are delivered through the real C++ engine; group
  chat (which the backend has no primitive for) is fan-out over each
  member's live WebSocket, gated by real server-held membership

**Frontend (Next.js/React)**
- Public chat, direct messages, and group chats in one interface
- Live presence indicators, online-user roster, group creation
- Auto-reconnect with backoff, and honest connection/loading/empty/error
  states — no fake data, no simulated functionality
- Dark, restrained, indigo-accented visual identity (see
  [Design](#-design) below)

---

# 🏗️ Architecture

```text
                    ┌──────────────────────┐
                    │   Next.js Frontend    │
                    │      (browser)        │
                    └──────────┬────────────┘
                               │ WebSocket (JSON)
                    ┌──────────▼────────────┐
                    │  Node.js / TypeScript  │
                    │   WebSocket Gateway    │
                    └──────────┬────────────┘
                               │ TCP (length-prefixed frames)
                    ┌──────────▼────────────┐
                    │   C++ ThreadLink       │
                    │       Server           │
                    └────────────────────────┘
```

Backend thread-per-client model:

```text
New Connection → accept() → Assign nickname, send WELCOME
    → Spawn handler thread → loop: recv_frame() → handle_line() → broadcast/reply
```

Gateway session model: each browser WebSocket maps 1:1 to its own
backend TCP connection, so the backend's existing per-client identity,
concurrency, and delivery guarantees carry straight through to the
browser — the gateway adds routing and application state on top, it
doesn't re-implement the transport layer.

---

# 📂 Project Structure

```text
ThreadLink/
├── include/, src/            # C++ backend (Protocol, Socket, Config, Log, Server)
├── client.cpp                 # terminal client
├── tests/run_tests.py         # backend integration test suite
├── docs/
│   ├── PROTOCOL.md            # C++ wire protocol (backend <-> gateway/terminal client)
│   └── GATEWAY_PROTOCOL.md    # browser <-> gateway JSON protocol
├── gateway/
│   ├── src/                   # gatewayServer, session/conversation management, protocol
│   └── tests/                 # unit tests + real end-to-end tests (spawns the real C++ binary)
├── frontend/
│   ├── app/, components/      # Next.js app, ThreadLink UI
│   ├── context/, lib/, types/ # state layer, transport, protocol types
│   └── tests/                 # reducer/protocol unit tests + live-stack tests
├── makefile
├── server.conf
└── README.md
```

---

# ⚙️ Prerequisites

- Linux
- g++ (C++17 or later), GNU Make, Python 3 (backend + its tests)
- Node.js 18+ (gateway and frontend)

```bash
sudo apt install build-essential python3   # Ubuntu/Debian
```

---

# 🚀 Setup & Run (all three tiers)

Run each in its own terminal, in this order:

**1. Backend**
```bash
make                # release build (server + client binaries in repo root)
./server             # listens on 127.0.0.1:8080 by default (server.conf)
```

**2. Gateway**
```bash
cd gateway
npm install
npm run build
GATEWAY_PORT=8081 BACKEND_HOST=127.0.0.1 BACKEND_PORT=8080 npm start
```

**3. Frontend**
```bash
cd frontend
npm install
npm run dev          # http://localhost:3000
```

Open `http://localhost:3000`, enter the gateway address
(`ws://127.0.0.1:8081` by default) and a nickname, and connect. Open a
second browser tab/window and connect again to chat between two
sessions — try public chat, a direct message, and creating a group.

### Terminal client (backend only, no gateway/frontend needed)
```bash
./client                  # connects to 127.0.0.1:8080
./client <host> <port>
```
Commands: `/nick <name>`, `/msg <user> <message>`, `/list`, `/exit`.

---

# ⚙️ Configuration

**Backend** (`server.conf`):
```text
PORT=8080
MAX_CLIENTS=100
MAX_MESSAGE_SIZE=8192
LOG_LEVEL=INFO
```
Missing/invalid values fall back to safe defaults with a warning — see `docs/PROTOCOL.md` §5.

**Gateway** (environment variables, all optional):

| Variable | Default | Notes |
|---|---|---|
| `GATEWAY_PORT` | `8081` | WebSocket listen port |
| `BACKEND_HOST` | `127.0.0.1` | C++ server host |
| `BACKEND_PORT` | `8080` | C++ server port |
| `MAX_CLIENT_MESSAGE_BYTES` | `16384` | Max inbound WS message size |
| `BACKEND_MAX_MESSAGE_BYTES` | `8192` | Must match backend's `MAX_MESSAGE_SIZE` |
| `LOG_LEVEL` | `info` | `debug`/`info`/`warn`/`error` |

**Frontend**: gateway URL and nickname are entered in-app (persisted to `localStorage`); no build-time config required.

---

# 🧪 Testing

Every layer has real tests — none of the numbers below are aspirational; see [Status](#-status) for when they were last run.

**Backend**
```bash
make debug                                  # AddressSanitizer + UndefinedBehaviorSanitizer
python3 tests/run_tests.py "$(pwd)/server"  # 15 tests: framing, concurrency, malformed input, shutdown, etc.

make tsan                                   # ThreadSanitizer (separate target; can't link with ASan)
python3 tests/run_tests.py "$(pwd)/server"
```

**Gateway**
```bash
cd gateway && npm test
```
38 unit tests (wire framing, protocol parsing/validation, conversation logic) + 16 end-to-end tests that spawn the *real* C++ server binary and drive it with real WebSocket clients — public chat, DMs, group membership/routing, presence, disconnect/reconnect, malformed input, backend-unavailable handling.

**Frontend**
```bash
cd frontend && npm test
```
Unit tests against the real `chatReducer` and protocol encode/decode, plus live-stack tests that spawn the real backend *and* real gateway and drive the actual `ThreadLinkClient` browser transport class against them.

---

# 🎨 Design

Dark-first, restrained blue/indigo accents, minimal surface layering
(`#070708` → `#101012` → `#141417`), no glassmorphism/gradients/neon.
Presence is a small colored dot (green/amber), not a badge farm;
conversations are grouped (Public / Direct Messages / Groups) rather
than dumped in one flat list; empty/loading/disconnected states are
explicit, not blank screens. See `frontend/components/` for the
implementation and `docs/GATEWAY_PROTOCOL.md` for the data model
driving it.

---

# ✅ Status

| Phase | Scope | Status |
|---|---|---|
| **1** | C++ backend: framing, RAII, config, logging, concurrency, tests, sanitizers | ✅ Complete |
| **2** | WebSocket gateway + connected web application | ✅ Complete |
| **3** | Real users, presence, conversations, DMs, group chats | ✅ Complete |
| 4+ | Persistence, auth, invites, advanced messaging, deployment | Not started (future work, out of current scope) |

**Known limitations (by design, not oversights):**
- No persistence — restart any tier and all users/conversations/history are gone (Phase 4)
- No authentication — any client can claim any free nickname (Phase 5)
- Reconnecting gets a new session/user id; group membership doesn't survive a member's disconnect, since there's no persistent identity to reattach to yet
- Group chat delivery is gateway-mediated (the C++ backend has no group primitive by design — see `docs/PROTOCOL.md` §6); public chat and DMs are delivered through the real backend engine unmodified

---

# 🛠️ Technologies Used

**Backend:** C++17, POSIX Sockets, Linux System Programming, Multithreading, TCP/IP, GNU Make, ASan/UBSan/TSan
**Gateway:** Node.js, TypeScript, `ws`, `node:test`
**Frontend:** Next.js, React, TypeScript, Tailwind CSS, Framer Motion, lucide-react

---

# 👨‍💻 Connect

- GitHub: https://github.com/kumar17aaditya
- LinkedIn: https://www.linkedin.com/in/aditya-kumar-82a292251/

---

⭐ If you found this project interesting, consider giving it a star!
