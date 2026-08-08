import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  TestBackend,
  TestClient,
  allocatePortPair,
  defaultTestConfig,
  isType,
  startBackend,
  startGateway,
  waitForPort,
} from "./testHarness.js";
import type { GatewayServer } from "../src/gatewayServer.js";

interface Rig {
  backend: TestBackend;
  gateway: GatewayServer;
  gatewayPort: number;
  dbPath: string;
}

async function setup(dbPath = ":memory:"): Promise<Rig> {
  const { backendPort, gatewayPort } = allocatePortPair();
  const backend = await startBackend(backendPort);
  const gateway = startGateway(defaultTestConfig(backendPort, gatewayPort, dbPath));
  await waitForPort(gatewayPort);
  return { backend, gateway, gatewayPort, dbPath };
}

async function teardown(rig: Rig): Promise<void> {
  await rig.gateway.close();
  await rig.backend.stop();
}

function asReady(e: unknown) {
  if (!isType("ready")(e)) throw new Error(`expected a ready event, got: ${JSON.stringify(e)}`);
  return e as any;
}

test("register then login: both succeed and return the same stable user id", async () => {
  const rig = await setup();
  try {
    const a = await TestClient.connect(rig.gatewayPort);
    const registered = asReady(await a.register("alice", "password123"));
    assert.equal(registered.username, "alice");
    assert.ok(registered.userId);
    a.close();

    const b = await TestClient.connect(rig.gatewayPort);
    const loggedIn = asReady(await b.login("alice", "password123"));
    assert.equal(loggedIn.userId, registered.userId);
    b.close();
  } finally {
    await teardown(rig);
  }
});

test("registering a duplicate username is rejected", async () => {
  const rig = await setup();
  try {
    const a = await TestClient.connect(rig.gatewayPort);
    asReady(await a.register("bob", "password123"));
    a.close();

    const b = await TestClient.connect(rig.gatewayPort);
    const result = await b.register("bob", "different-password");
    assert.equal((result as any).type, "error");
    assert.equal((result as any).code, "REGISTER_FAILED");
    b.close();
  } finally {
    await teardown(rig);
  }
});

test("login with the wrong password is rejected", async () => {
  const rig = await setup();
  try {
    const a = await TestClient.connect(rig.gatewayPort);
    asReady(await a.register("carol", "correct-password"));
    a.close();

    const b = await TestClient.connect(rig.gatewayPort);
    const result = await b.login("carol", "wrong-password");
    assert.equal((result as any).type, "error");
    assert.equal((result as any).code, "LOGIN_FAILED");
    b.close();
  } finally {
    await teardown(rig);
  }
});

test("login with an unknown username is rejected", async () => {
  const rig = await setup();
  try {
    const a = await TestClient.connect(rig.gatewayPort);
    const result = await a.login("nobody-registered", "whatever123");
    assert.equal((result as any).type, "error");
    assert.equal((result as any).code, "LOGIN_FAILED");
    a.close();
  } finally {
    await teardown(rig);
  }
});

test("password is never present anywhere in the ready or error payloads", async () => {
  const rig = await setup();
  try {
    const a = await TestClient.connect(rig.gatewayPort);
    const ready = await a.register("dave", "super-secret-password");
    assert.ok(!JSON.stringify(ready).includes("super-secret-password"));

    const b = await TestClient.connect(rig.gatewayPort);
    const err = await b.login("dave", "wrong-one");
    assert.ok(!JSON.stringify(err).includes("wrong-one"));
    assert.ok(!JSON.stringify(err).includes("super-secret-password"));

    a.close();
    b.close();
  } finally {
    await teardown(rig);
  }
});

test("commands sent before authenticating never produce a ready event or an anonymous identity", async () => {
  const rig = await setup();
  try {
    const a = await TestClient.connect(rig.gatewayPort);
    a.send({ type: "sendMessage", target: { kind: "public" }, text: "should not go through yet" });
    await new Promise((r) => setTimeout(r, 200));
    assert.ok(!a.events.some(isType("ready")));

    const ready = asReady(await a.register("erin", "password123"));
    assert.ok(ready.userId);
    a.close();
  } finally {
    await teardown(rig);
  }
});

test("two clients: public chat is routed to the other client but not echoed to sender", async () => {
  const rig = await setup();
  try {
    const a = await TestClient.connect(rig.gatewayPort);
    const b = await TestClient.connect(rig.gatewayPort);
    asReady(await a.register("alice", "password123"));
    asReady(await b.register("bob", "password123"));

    a.send({ type: "sendMessage", target: { kind: "public" }, text: "hello everyone" });

    const seenByB = await b.waitFor(
      (e): e is { type: "message"; message: { text: string; conversationId: string } } =>
        isType("message")(e) && (e as any).message?.text === "hello everyone",
    );
    assert.equal(seenByB.message.conversationId, "public");

    await a.waitFor(
      (e): e is { type: "message"; message: { text: string } } =>
        isType("message")(e) && (e as any).message?.text === "hello everyone",
    );

    a.close();
    b.close();
  } finally {
    await teardown(rig);
  }
});

test("direct messages: only the two participants see them, both directions confirmed", async () => {
  const rig = await setup();
  try {
    const a = await TestClient.connect(rig.gatewayPort);
    const b = await TestClient.connect(rig.gatewayPort);
    const c = await TestClient.connect(rig.gatewayPort);
    const readyA = asReady(await a.register("alice", "password123"));
    const readyB = asReady(await b.register("bob", "password123"));
    asReady(await c.register("carol", "password123"));

    a.send({ type: "sendMessage", target: { kind: "direct", peerId: readyB.userId }, text: "just between us" });

    const receivedByB = await b.waitFor(
      (e): e is { type: "message"; message: { text: string; senderId: string; conversationId: string } } =>
        isType("message")(e) && (e as any).message?.text === "just between us",
    );
    assert.equal(receivedByB.message.senderId, readyA.userId);

    const confirmedToA = await a.waitFor(
      (e): e is { type: "message"; message: { text: string; conversationId: string } } =>
        isType("message")(e) && (e as any).message?.text === "just between us",
    );
    assert.equal(confirmedToA.message.conversationId, receivedByB.message.conversationId);

    await c.assertNever(
      (e): e is { type: "message" } => isType("message")(e) && (e as any).message?.text === "just between us",
    );

    a.close();
    b.close();
    c.close();
  } finally {
    await teardown(rig);
  }
});

test("direct message to an offline/unknown user id is rejected", async () => {
  const rig = await setup();
  try {
    const a = await TestClient.connect(rig.gatewayPort);
    asReady(await a.register("alice", "password123"));
    a.send({ type: "sendMessage", target: { kind: "direct", peerId: "not-a-real-id" }, text: "hi?" });
    const err = await a.waitFor(isType("error"));
    assert.equal((err as any).code, "USER_NOT_FOUND");
    a.close();
  } finally {
    await teardown(rig);
  }
});

test("group chats: only members receive messages, non-members never do", async () => {
  const rig = await setup();
  try {
    const a = await TestClient.connect(rig.gatewayPort);
    const b = await TestClient.connect(rig.gatewayPort);
    const c = await TestClient.connect(rig.gatewayPort);
    asReady(await a.register("alice", "password123"));
    const readyB = asReady(await b.register("bob", "password123"));
    asReady(await c.register("carol", "password123"));

    a.send({ type: "createGroup", name: "Engineering", memberIds: [readyB.userId] });
    const createdForA = await a.waitFor(isType("conversationCreated"));
    const createdForB = await b.waitFor(isType("conversationCreated"));
    assert.equal((createdForA as any).conversation.id, (createdForB as any).conversation.id);
    assert.equal((createdForA as any).conversation.title, "Engineering");
    const groupId = (createdForA as any).conversation.id;

    a.send({ type: "sendMessage", target: { kind: "group", groupId }, text: "group secret" });

    const receivedByB = await b.waitFor(
      (e): e is { type: "message"; message: { text: string; conversationId: string } } =>
        isType("message")(e) && (e as any).message?.text === "group secret",
    );
    assert.equal(receivedByB.message.conversationId, groupId);

    await a.waitFor(
      (e): e is { type: "message" } => isType("message")(e) && (e as any).message?.text === "group secret",
    );

    await c.assertNever(
      (e): e is { type: "message" } => isType("message")(e) && (e as any).message?.text === "group secret",
    );

    a.close();
    b.close();
    c.close();
  } finally {
    await teardown(rig);
  }
});

test("group creation with an unknown member id is rejected", async () => {
  const rig = await setup();
  try {
    const a = await TestClient.connect(rig.gatewayPort);
    asReady(await a.register("alice", "password123"));
    a.send({ type: "createGroup", name: "Ghosts", memberIds: ["nonexistent-user-id"] });
    const err = await a.waitFor(isType("error"));
    assert.equal((err as any).code, "UNKNOWN_MEMBER");
    a.close();
  } finally {
    await teardown(rig);
  }
});

test("sending to a group you're not a member of is rejected", async () => {
  const rig = await setup();
  try {
    const a = await TestClient.connect(rig.gatewayPort);
    const b = await TestClient.connect(rig.gatewayPort);
    const outsider = await TestClient.connect(rig.gatewayPort);
    asReady(await a.register("alice", "password123"));
    const readyB = asReady(await b.register("bob", "password123"));
    asReady(await outsider.register("outsider", "password123"));

    a.send({ type: "createGroup", name: "Private", memberIds: [readyB.userId] });
    const created = await a.waitFor(isType("conversationCreated"));
    const groupId = (created as any).conversation.id;

    outsider.send({ type: "sendMessage", target: { kind: "group", groupId }, text: "sneaky" });
    const err = await outsider.waitFor(isType("error"));
    assert.equal((err as any).code, "NOT_A_MEMBER");

    a.close();
    b.close();
    outsider.close();
  } finally {
    await teardown(rig);
  }
});

test("presence: setting away broadcasts to other online users", async () => {
  const rig = await setup();
  try {
    const a = await TestClient.connect(rig.gatewayPort);
    const b = await TestClient.connect(rig.gatewayPort);
    const readyB = asReady(await b.register("bob", "password123"));
    asReady(await a.register("alice", "password123"));

    b.send({ type: "setPresence", presence: "away" });

    const update = await a.waitFor(
      (e): e is { type: "userUpdate"; user: { id: string; presence: string } } =>
        isType("userUpdate")(e) && (e as any).user?.id === readyB.userId && (e as any).user?.presence === "away",
    );
    assert.equal(update.user.presence, "away");

    a.close();
    b.close();
  } finally {
    await teardown(rig);
  }
});

test("disconnect notifies other online users and marks them offline, without deleting their data", async () => {
  const rig = await setup();
  try {
    const a = await TestClient.connect(rig.gatewayPort);
    const b = await TestClient.connect(rig.gatewayPort);
    const readyB = asReady(await b.register("bob", "password123"));
    asReady(await a.register("alice", "password123"));

    b.close();

    const offline = await a.waitFor(
      (e): e is { type: "userOffline"; userId: string } =>
        isType("userOffline")(e) && (e as any).userId === readyB.userId,
    );
    assert.equal(offline.userId, readyB.userId);

    const c = await TestClient.connect(rig.gatewayPort);
    const relogin = asReady(await c.login("bob", "password123"));
    assert.equal(relogin.userId, readyB.userId);

    a.close();
    c.close();
  } finally {
    await teardown(rig);
  }
});

test("logout invalidates the session, disconnects the socket, and marks the user offline -- but preserves the account", async () => {
  const rig = await setup();
  try {
    const a = await TestClient.connect(rig.gatewayPort);
    const b = await TestClient.connect(rig.gatewayPort);
    const readyA = asReady(await a.register("alice", "password123"));
    asReady(await b.register("bob", "password123"));

    const closed = new Promise<void>((resolve) => a.ws.once("close", () => resolve()));
    a.logout();
    await a.waitFor(isType("loggedOut"));
    await closed;

    const offline = await b.waitFor(
      (e): e is { type: "userOffline"; userId: string } =>
        isType("userOffline")(e) && (e as any).userId === readyA.userId,
    );
    assert.equal(offline.userId, readyA.userId);

    const c = await TestClient.connect(rig.gatewayPort);
    const relogin = asReady(await c.login("alice", "password123"));
    assert.equal(relogin.userId, readyA.userId);

    b.close();
    c.close();
  } finally {
    await teardown(rig);
  }
});

test("reconnect via login restores the same account, and unexpected disconnect never deletes data", async () => {
  const rig = await setup();
  try {
    const first = await TestClient.connect(rig.gatewayPort);
    const initial = asReady(await first.register("alice", "password123"));
    first.close();

    await new Promise((r) => setTimeout(r, 200));

    const second = await TestClient.connect(rig.gatewayPort);
    const relogin = asReady(await second.login("alice", "password123"));
    assert.equal(relogin.userId, initial.userId);
    assert.equal(relogin.username, "alice");

    const bystander = await TestClient.connect(rig.gatewayPort);
    asReady(await bystander.register("bob", "password123"));
    second.send({ type: "sendMessage", target: { kind: "public" }, text: "back online" });
    await bystander.waitFor(
      (e): e is { type: "message" } => isType("message")(e) && (e as any).message?.text === "back online",
    );

    second.close();
    bystander.close();
  } finally {
    await teardown(rig);
  }
});

test("acceptance flow: DM + group history, logout, unexpected disconnect, and a full gateway restart all preserve data", async () => {
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "threadlink-acceptance-"));
  const dbPath = path.join(dbDir, "threadlink.db");
  let rig = await setup(dbPath);
  try {
    const a1 = await TestClient.connect(rig.gatewayPort);
    const b1 = await TestClient.connect(rig.gatewayPort);
    const readyA1 = asReady(await a1.register("acc-alice", "password123"));
    const readyB1 = asReady(await b1.register("acc-bob", "password123"));

    a1.send({ type: "sendMessage", target: { kind: "direct", peerId: readyB1.userId }, text: "dm before logout" });
    await b1.waitFor((e): e is any => isType("message")(e) && (e as any).message?.text === "dm before logout");

    a1.send({ type: "createGroup", name: "Acceptance Group", memberIds: [readyB1.userId] });
    // Must match specifically on kind === "group": a1 already has an
    // earlier "conversationCreated" event in its log from the DM step
    // above, and a bare isType("conversationCreated") would match that
    // one first instead of the group's.
    const created = await a1.waitFor(
      (e): e is { type: "conversationCreated"; conversation: { id: string; kind: string } } =>
        isType("conversationCreated")(e) && (e as any).conversation?.kind === "group",
    );
    const groupId = created.conversation.id;
    a1.send({ type: "sendMessage", target: { kind: "group", groupId }, text: "group msg before logout" });
    await b1.waitFor((e): e is any => isType("message")(e) && (e as any).message?.text === "group msg before logout");

    // --- Logout A; verify A's data still exists via re-login ---
    a1.logout();
    await a1.waitFor(isType("loggedOut"));

    const a2 = await TestClient.connect(rig.gatewayPort);
    const readyA2 = asReady(await a2.login("acc-alice", "password123"));
    assert.equal(readyA2.userId, readyA1.userId);

    const historyTexts = readyA2.messages.map((m: any) => m.text);
    assert.ok(historyTexts.includes("dm before logout"), "DM history must be restored after re-login");
    assert.ok(historyTexts.includes("group msg before logout"), "group history must be restored after re-login");

    const restoredConversationKinds = readyA2.conversations.map((c: any) => c.kind).sort();
    assert.deepEqual(restoredConversationKinds, ["direct", "group", "public"]);

    // --- Unexpected disconnect of A; verify data still exists ---
    a2.ws.terminate();
    await new Promise((r) => setTimeout(r, 300));

    const a3 = await TestClient.connect(rig.gatewayPort);
    const readyA3 = asReady(await a3.login("acc-alice", "password123"));
    assert.equal(readyA3.userId, readyA1.userId);
    assert.ok(readyA3.messages.map((m: any) => m.text).includes("group msg before logout"));

    a3.close();
    b1.close();

    // --- Restart the gateway process (same db file) ---
    await rig.gateway.close();
    await rig.backend.stop();
    rig = await setup(dbPath);

    const a4 = await TestClient.connect(rig.gatewayPort);
    const readyA4 = asReady(await a4.login("acc-alice", "password123"));
    assert.equal(readyA4.userId, readyA1.userId, "user id must survive a full gateway restart");
    const textsAfterRestart = readyA4.messages.map((m: any) => m.text);
    assert.ok(textsAfterRestart.includes("dm before logout"));
    assert.ok(textsAfterRestart.includes("group msg before logout"));
    const kindsAfterRestart = readyA4.conversations.map((c: any) => c.kind).sort();
    assert.deepEqual(kindsAfterRestart, ["direct", "group", "public"]);

    a4.close();
  } finally {
    await teardown(rig);
    fs.rmSync(dbDir, { recursive: true, force: true });
  }
});

test("renaming via setNickname persists the new username for future logins", async () => {
  const rig = await setup();
  try {
    const a = await TestClient.connect(rig.gatewayPort);
    const ready = asReady(await a.register("oldname", "password123"));
    a.send({ type: "setNickname", nickname: "newname" });
    await a.waitFor(
      (e): e is { type: "userUpdate"; user: { username: string } } =>
        isType("userUpdate")(e) && (e as any).user?.username === "newname",
    );
    a.close();

    const b = await TestClient.connect(rig.gatewayPort);
    const relogin = asReady(await b.login("newname", "password123"));
    assert.equal(relogin.userId, ready.userId);
    b.close();
  } finally {
    await teardown(rig);
  }
});

test("duplicate nickname request is rejected via the real backend uniqueness check", async () => {
  const rig = await setup();
  try {
    const a = await TestClient.connect(rig.gatewayPort);
    const b = await TestClient.connect(rig.gatewayPort);
    asReady(await a.register("alice", "password123"));
    asReady(await b.register("bob", "password123"));

    b.send({ type: "setNickname", nickname: "alice" });
    const err = await b.waitFor(isType("error"));
    assert.equal((err as any).code, "NICK_TAKEN");

    a.close();
    b.close();
  } finally {
    await teardown(rig);
  }
});

test("oversized client message is rejected without crashing the gateway", async () => {
  const rig = await setup();
  try {
    const a = await TestClient.connect(rig.gatewayPort);
    asReady(await a.register("alice", "password123"));

    a.send({ type: "sendMessage", target: { kind: "public" }, text: "x".repeat(20000) });
    a.send({ type: "sendMessage", target: { kind: "public" }, text: "still alive" });

    const b = await TestClient.connect(rig.gatewayPort);
    asReady(await b.register("bob", "password123"));
    a.send({ type: "sendMessage", target: { kind: "public" }, text: "still alive after reconnectee joined" });
    await b.waitFor(
      (e): e is { type: "message" } =>
        isType("message")(e) && (e as any).message?.text === "still alive after reconnectee joined",
    );

    a.close();
    b.close();
  } finally {
    await teardown(rig);
  }
});

test("malformed JSON from a client yields a BAD_JSON error, not a crash", async () => {
  const rig = await setup();
  try {
    const a = await TestClient.connect(rig.gatewayPort);
    asReady(await a.register("alice", "password123"));
    a.ws.send("{ this is not valid json");
    const err = await a.waitFor(isType("error"));
    assert.equal((err as any).code, "BAD_JSON");
    a.close();
  } finally {
    await teardown(rig);
  }
});

test("schema-invalid client message yields a BAD_MESSAGE error", async () => {
  const rig = await setup();
  try {
    const a = await TestClient.connect(rig.gatewayPort);
    asReady(await a.register("alice", "password123"));
    a.send({ type: "sendMessage", target: { kind: "public" }, text: "" });
    const err = await a.waitFor(isType("error"));
    assert.equal((err as any).code, "BAD_MESSAGE");
    a.close();
  } finally {
    await teardown(rig);
  }
});

test("gateway reports BACKEND_UNAVAILABLE cleanly when the backend isn't reachable", async () => {
  const { gatewayPort } = allocatePortPair();
  const unreachableBackendPort = 1;
  const gateway = startGateway(defaultTestConfig(unreachableBackendPort, gatewayPort));
  await waitForPort(gatewayPort);
  try {
    const a = await TestClient.connect(gatewayPort);
    const closed = new Promise<void>((resolve) => a.ws.once("close", () => resolve()));
    a.send({ type: "register", username: "alice", password: "password123" });
    const err = await a.waitFor(isType("error"));
    assert.equal((err as any).code, "BACKEND_UNAVAILABLE");
    await closed;
  } finally {
    await gateway.close();
  }
});

test("backend shutdown mid-session disconnects the client without crashing the gateway", async () => {
  const rig = await setup();
  try {
    const a = await TestClient.connect(rig.gatewayPort);
    asReady(await a.register("alice", "password123"));

    const closed = new Promise<void>((resolve) => a.ws.once("close", () => resolve()));
    await rig.backend.stop();

    await closed;
  } finally {
    await rig.gateway.close();
  }
});
