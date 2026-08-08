# ThreadLink Gateway

A thin Node.js/TypeScript WebSocket↔TCP bridge between the browser
frontend and the C++ ThreadLink server. Speaks the browser's JSON
protocol on one side (`../docs/GATEWAY_PROTOCOL.md`) and the backend's
length-prefixed text protocol on the other (`../docs/PROTOCOL.md`).

See the [root README](../README.md) for the full three-tier setup and
current project status.

## Run

```bash
npm install
npm run build
GATEWAY_PORT=8081 BACKEND_HOST=127.0.0.1 BACKEND_PORT=8080 npm start
```

Or for iterative development:

```bash
npm run dev    # tsc --watch; run `node dist/src/index.js` separately after each build
```

All configuration is via environment variables — see the root README's
Configuration section for the full list and defaults.

## Test

```bash
npm test
```

Runs 38 unit tests (wire framing, backend message parsing, client
protocol validation, conversation/group membership logic) plus 16
end-to-end tests that spawn the *real* `server` binary from the repo
root and drive it with real WebSocket clients (`gateway/tests/e2e.test.ts`)
— public chat, DMs, group routing and membership enforcement, presence,
disconnect/reconnect, duplicate nicknames, malformed/oversized input,
and backend-unavailable/backend-shutdown handling. Requires `../server`
to already be built (`make` from the repo root).

## Architecture

One dedicated TCP connection to the C++ backend per browser
WebSocket session (`src/backendConnection.ts` + `src/session.ts`) —
this is deliberate: it lets the gateway reuse the backend's existing,
tested nickname-uniqueness, broadcast, and private-message delivery
instead of re-implementing any of that logic in Node.

```text
src/
  wireProtocol.ts          Length-prefixed TCP framing (mirrors include/Protocol.h)
  backendMessages.ts        Parses/formats the backend's WELCOME/SYS/MSG/PRIV/NICK/LIST/ERR vocabulary
  backendConnection.ts       One TCP connection per session
  clientProtocol.ts          Browser<->gateway JSON types + inbound validation
  session.ts / sessionManager.ts   Per-connection state, roster
  conversationManager.ts     Public/direct/group conversation model and membership
  gatewayServer.ts           Orchestrator: wires everything together, all routing decisions
  config.ts, logger.ts       Validated env config, leveled logging (mirrors backend's Log.h format)
```

Group chat is the one thing not backed by the C++ server directly (it
has no group primitive by design — `docs/PROTOCOL.md` §6): group
membership and message fan-out are real, gateway-owned application
state, delivered over each member's own live WebSocket session. Public
chat and direct messages are delivered through the real backend engine
unmodified.
