# ThreadLink Frontend

The Next.js/React web client for ThreadLink. Talks to the gateway
(`../gateway/`) over WebSocket using the JSON protocol documented in
[`../docs/GATEWAY_PROTOCOL.md`](../docs/GATEWAY_PROTOCOL.md) — it never
connects to the C++ backend directly.

See the [root README](../README.md) for the full three-tier setup
(backend + gateway + frontend) and current project status.

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You'll need the
gateway (and the C++ backend behind it) running first — see the root
README's Setup & Run section.

## Test

```bash
npm test
```

Runs unit tests against the real `chatReducer` and protocol
encode/decode (`tests/chatReducer.test.ts`, `tests/protocol.test.ts`),
plus live-stack tests that spawn the real gateway and real C++ backend
and drive the actual `ThreadLinkClient` transport class against them
(`tests/liveStack.test.ts`). Uses Node's built-in test runner
(`node:test`) with a small local loader (`tests/aliasResolver.mjs`) to
resolve the `@/*` path alias — no separate test framework dependency.

## Layout

```text
app/                 Next.js App Router entry (layout, page)
components/           UI components (ThreadLink's dark/indigo design system)
context/
  chatState.ts         Pure state: reducer + action/state types (no React/JSX; unit-testable directly)
  ChatProvider.tsx      React context wiring chatState.ts into the WebSocket transport
lib/
  websocket-client.ts   Transport layer: WebSocket lifecycle, reconnect backoff, encode/decode
  storage.ts, id.ts, format.ts
types/
  protocol.ts            Browser<->gateway JSON protocol types (mirrors docs/GATEWAY_PROTOCOL.md)
  chat.ts                 Frontend-internal domain types (User, Conversation, Message)
tests/                 Unit + live-stack tests (see above)
```

Architecture is layered deliberately: WebSocket transport → protocol
parsing → connection/user/conversation/message state (in
`chatState.ts`) → UI. Components read everything through the
`useChat()` hook; nothing talks to the WebSocket directly except
`ChatProvider`.

## Design

Dark-first, restrained blue/indigo accents (`#070708` background,
`#101012`/`#141417` surfaces), Tailwind CSS + Framer Motion for subtle
motion, lucide-react icons. See the root README's Design section for
the intent behind it.

## Known limitation

`next build` cannot complete in network-restricted sandboxes that
can't reach `fonts.googleapis.com` (used by `next/font/google` for
Geist). `next dev` is unaffected — it falls back to system fonts
automatically. Not a code defect.
