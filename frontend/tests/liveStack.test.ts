/**
 * Exercises the frontend's ACTUAL WebSocket client (lib/websocket-client.ts,
 * built on the real types/protocol.ts encode/decode) against the real
 * gateway and real C++ backend. This is the closest thing to "browser
 * validation" available in this environment without pulling in a
 * headless-browser dependency: it's the exact client code a browser
 * tab would run, driving a real network round trip through the whole
 * stack, not a hand-rolled substitute.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess, ChildProcessWithoutNullStreams } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ThreadLinkClient } from "@/lib/websocket-client";
import type { ServerMessage } from "@/types/protocol";

// Node's ESM loader has no browser WebSocket global; use the same `ws`
// package the gateway itself depends on (already present in the repo,
// not a new dependency) and hand it to the frontend client the same
// way a browser would provide `window.WebSocket`.
// @ts-expect-error -- plain runtime import, no type declarations needed for this test-only shim
import { WebSocket as NodeWebSocket } from "../../gateway/node_modules/ws/wrapper.mjs";
(globalThis as unknown as { WebSocket: unknown }).WebSocket = NodeWebSocket;

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const BACKEND_BIN = path.join(REPO_ROOT, "server");
const GATEWAY_ENTRY = path.join(REPO_ROOT, "gateway/dist/src/index.js");

function waitForPort(port: number, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    function attempt() {
      const sock = net.createConnection(port, "127.0.0.1");
      sock.once("connect", () => {
        sock.end();
        resolve();
      });
      sock.once("error", () => {
        sock.destroy();
        if (Date.now() > deadline) reject(new Error(`timed out waiting for port ${port}`));
        else setTimeout(attempt, 30);
      });
    }
    attempt();
  });
}

let nextPort = 19200;
function allocatePorts() {
  return { backendPort: nextPort++, gatewayPort: nextPort++ };
}

interface Stack {
  backend: ChildProcessWithoutNullStreams;
  gateway: ChildProcess;
  gatewayUrl: string;
  dir: string;
}

async function startStack(): Promise<Stack> {
  const { backendPort, gatewayPort } = allocatePorts();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "threadlink-frontend-live-"));
  fs.writeFileSync(
    path.join(dir, "server.conf"),
    `PORT=${backendPort}\nMAX_CLIENTS=20\nMAX_MESSAGE_SIZE=8192\nLOG_LEVEL=WARN\n`,
  );

  const backend = spawn(BACKEND_BIN, [], { cwd: dir, stdio: ["pipe", "pipe", "pipe"] }) as ChildProcessWithoutNullStreams;
  backend.stdout.on("data", () => {});
  backend.stderr.on("data", () => {});
  await waitForPort(backendPort);

  const gateway = spawn(process.execPath, [GATEWAY_ENTRY], {
    env: {
      ...process.env,
      GATEWAY_PORT: String(gatewayPort),
      BACKEND_HOST: "127.0.0.1",
      BACKEND_PORT: String(backendPort),
      LOG_LEVEL: "error",
      DB_PATH: ":memory:",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  gateway.stdout?.on("data", () => {});
  gateway.stderr?.on("data", () => {});
  await waitForPort(gatewayPort);

  return { backend, gateway, gatewayUrl: `ws://127.0.0.1:${gatewayPort}`, dir };
}

async function stopStack(stack: Stack): Promise<void> {
  stack.gateway.kill("SIGKILL");
  try {
    stack.backend.stdin.write("SHUTDOWN\n");
  } catch {
    /* already gone */
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      stack.backend.kill("SIGKILL");
      resolve();
    }, 1500);
    stack.backend.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  fs.rmSync(stack.dir, { recursive: true, force: true });
}

function makeClient(url: string): { client: ThreadLinkClient; events: ServerMessage[]; connectedPromise: Promise<void> } {
  const events: ServerMessage[] = [];
  let resolveConnected: () => void;
  const connectedPromise = new Promise<void>((resolve) => {
    resolveConnected = resolve;
  });
  const client = new ThreadLinkClient({
    url,
    onStatusChange: (status) => {
      if (status === "connected") resolveConnected();
    },
    onEvent: (event) => events.push(event),
    onError: () => {},
    reconnect: false,
  });
  return { client, events, connectedPromise };
}

async function waitFor<T extends ServerMessage>(
  events: ServerMessage[],
  predicate: (e: ServerMessage) => e is T,
  timeoutMs = 3000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = events.find(predicate);
    if (found) return found;
    if (Date.now() > deadline) throw new Error(`timed out; saw: ${JSON.stringify(events, null, 2)}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

const isReady = (e: ServerMessage): e is Extract<ServerMessage, { type: "ready" }> => e.type === "ready";
const isMessage = (e: ServerMessage): e is Extract<ServerMessage, { type: "message" }> => e.type === "message";
const isConversationCreated = (e: ServerMessage): e is Extract<ServerMessage, { type: "conversationCreated" }> =>
  e.type === "conversationCreated";

test("frontend ThreadLinkClient: register, get ready, and exchange a real public message end-to-end", async () => {
  const stack = await startStack();
  try {
    const a = makeClient(stack.gatewayUrl);
    const b = makeClient(stack.gatewayUrl);
    a.client.connect();
    b.client.connect();
    await a.connectedPromise;
    await b.connectedPromise;

    a.client.register("frontend-alice", "password123");
    b.client.register("frontend-bob", "password123");
    const readyA = await waitFor(a.events, isReady);
    await waitFor(b.events, isReady);
    assert.ok(readyA.userId);
    assert.equal(readyA.username, "frontend-alice");

    a.client.sendMessage({ kind: "public" }, "hello from the real frontend client");
    const seenByB = await waitFor(b.events, isMessage);
    assert.equal(seenByB.message.text, "hello from the real frontend client");
    assert.equal(seenByB.message.conversationId, "public");

    a.client.disconnect();
    b.client.disconnect();
  } finally {
    await stopStack(stack);
  }
});

test("frontend ThreadLinkClient: direct message round-trip using real userIds from ready events", async () => {
  const stack = await startStack();
  try {
    const a = makeClient(stack.gatewayUrl);
    const b = makeClient(stack.gatewayUrl);
    a.client.connect();
    b.client.connect();
    await a.connectedPromise;
    await b.connectedPromise;

    a.client.register("frontend-alice", "password123");
    b.client.register("frontend-bob", "password123");
    const readyA = await waitFor(a.events, isReady);
    const readyB = await waitFor(b.events, isReady);

    a.client.sendMessage({ kind: "direct", peerId: readyB.userId }, "just for you");

    const receivedByB = await waitFor(b.events, isMessage);
    assert.equal(receivedByB.message.text, "just for you");
    assert.equal(receivedByB.message.senderId, readyA.userId);

    await waitFor(a.events, isMessage); // PRIV_SENT confirmation, real backend round trip

    a.client.disconnect();
    b.client.disconnect();
  } finally {
    await stopStack(stack);
  }
});

test("frontend ThreadLinkClient: group creation and message fan-out", async () => {
  const stack = await startStack();
  try {
    const a = makeClient(stack.gatewayUrl);
    const b = makeClient(stack.gatewayUrl);
    const c = makeClient(stack.gatewayUrl);
    a.client.connect();
    b.client.connect();
    c.client.connect();
    await Promise.all([a.connectedPromise, b.connectedPromise, c.connectedPromise]);

    a.client.register("frontend-alice", "password123");
    b.client.register("frontend-bob", "password123");
    c.client.register("frontend-carol", "password123");
    const readyB = await waitFor(b.events, isReady);
    await waitFor(a.events, isReady);
    await waitFor(c.events, isReady);

    a.client.createGroup("Frontend Test Group", [readyB.userId]);
    const created = await waitFor(a.events, isConversationCreated);
    assert.equal(created.conversation.title, "Frontend Test Group");

    a.client.sendMessage({ kind: "group", groupId: created.conversation.id }, "group hello");
    const seenByB = await waitFor(b.events, isMessage);
    assert.equal(seenByB.message.text, "group hello");

    // c was never invited -- give it a beat, then confirm it never saw the group message.
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(!c.events.some((e) => isMessage(e) && e.message.text === "group hello"));

    a.client.disconnect();
    b.client.disconnect();
    c.client.disconnect();
  } finally {
    await stopStack(stack);
  }
});

test("frontend ThreadLinkClient: nickname change surfaces via the real backend uniqueness check", async () => {
  const stack = await startStack();
  try {
    const a = makeClient(stack.gatewayUrl);
    a.client.connect();
    await a.connectedPromise;
    a.client.register("frontend-oldname", "password123");
    await waitFor(a.events, isReady);

    a.client.setNickname("frontend-e2e-name");
    const update = await waitFor(
      (a.events as unknown as ServerMessage[]),
      (e): e is Extract<ServerMessage, { type: "userUpdate" }> => e.type === "userUpdate" && e.user.username === "frontend-e2e-name",
    );
    assert.equal(update.user.username, "frontend-e2e-name");

    a.client.disconnect();
  } finally {
    await stopStack(stack);
  }
});

test("frontend ThreadLinkClient: logout then login again restores identity and message history", async () => {
  const stack = await startStack();
  try {
    const a1 = makeClient(stack.gatewayUrl);
    a1.client.connect();
    await a1.connectedPromise;
    a1.client.register("frontend-persist", "password123");
    const initial = await waitFor(a1.events, isReady);

    a1.client.sendMessage({ kind: "public" }, "before logout");
    await waitFor(a1.events, isMessage);

    const loggedOutPromise = new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (a1.events.some((e) => e.type === "loggedOut")) {
          clearInterval(interval);
          resolve();
        }
      }, 20);
    });
    a1.client.logout();
    await loggedOutPromise;

    const a2 = makeClient(stack.gatewayUrl);
    a2.client.connect();
    await a2.connectedPromise;
    a2.client.login("frontend-persist", "password123");
    const restored = await waitFor(a2.events, isReady);

    assert.equal(restored.userId, initial.userId);
    assert.ok(restored.messages.some((m) => m.text === "before logout"), "message history must be restored after re-login");

    a2.client.disconnect();
  } finally {
    await stopStack(stack);
  }
});
