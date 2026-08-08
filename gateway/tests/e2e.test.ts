import { test } from "node:test";
import assert from "node:assert/strict";
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
}

async function setup(): Promise<Rig> {
  const { backendPort, gatewayPort } = allocatePortPair();
  const backend = await startBackend(backendPort);
  const gateway = startGateway(defaultTestConfig(backendPort, gatewayPort));
  await waitForPort(gatewayPort);
  return { backend, gateway, gatewayPort };
}

async function teardown(rig: Rig): Promise<void> {
  await rig.gateway.close();
  await rig.backend.stop();
}

test("two clients: public chat is routed to the other client but not echoed to sender", async () => {
  const rig = await setup();
  try {
    const a = await TestClient.connect(rig.gatewayPort);
    const b = await TestClient.connect(rig.gatewayPort);
    await a.waitFor(isType("ready"));
    await b.waitFor(isType("ready"));

    a.send({ type: "sendMessage", target: { kind: "public" }, text: "hello everyone" });

    const seenByB = await b.waitFor(
      (e): e is { type: "message"; message: { text: string; conversationId: string } } =>
        isType("message")(e) && (e as any).message?.text === "hello everyone",
    );
    assert.equal(seenByB.message.conversationId, "public");

    // Sender sees its own message too (synthesized locally since the
    // backend doesn't echo broadcasts back to the sender).
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
    const c = await TestClient.connect(rig.gatewayPort); // bystander, must never see this DM
    const readyA = await a.waitFor(isType("ready"));
    const readyB = await b.waitFor(isType("ready"));
    await c.waitFor(isType("ready"));

    a.send({
      type: "sendMessage",
      target: { kind: "direct", peerId: (readyB as any).userId },
      text: "just between us",
    });

    const receivedByB = await b.waitFor(
      (e): e is { type: "message"; message: { text: string; senderId: string; conversationId: string } } =>
        isType("message")(e) && (e as any).message?.text === "just between us",
    );
    assert.equal(receivedByB.message.senderId, (readyA as any).userId);

    // Sender gets a real delivery confirmation via the backend's own
    // PRIV_SENT frame, not a locally-fabricated echo.
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
    await a.waitFor(isType("ready"));
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
    const c = await TestClient.connect(rig.gatewayPort); // not invited
    const readyA = await a.waitFor(isType("ready"));
    const readyB = await b.waitFor(isType("ready"));
    await c.waitFor(isType("ready"));

    a.send({ type: "createGroup", name: "Engineering", memberIds: [(readyB as any).userId] });
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

    // The sender also gets their own copy for their own conversation view.
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
    await a.waitFor(isType("ready"));
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
    await a.waitFor(isType("ready"));
    const readyB = await b.waitFor(isType("ready"));
    await outsider.waitFor(isType("ready"));

    a.send({ type: "createGroup", name: "Private", memberIds: [(readyB as any).userId] });
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
    const readyB = await b.waitFor(isType("ready"));
    await a.waitFor(isType("ready"));

    b.send({ type: "setPresence", presence: "away" });

    // Must specifically match the *away* update -- B's connection also
    // fires an initial "online" userUpdate broadcast on welcome, which
    // arrives first and must not be mistaken for this one.
    const update = await a.waitFor(
      (e): e is { type: "userUpdate"; user: { id: string; presence: string } } =>
        isType("userUpdate")(e) &&
        (e as any).user?.id === (readyB as any).userId &&
        (e as any).user?.presence === "away",
    );
    assert.equal(update.user.presence, "away");

    a.close();
    b.close();
  } finally {
    await teardown(rig);
  }
});

test("disconnect notifies other online users", async () => {
  const rig = await setup();
  try {
    const a = await TestClient.connect(rig.gatewayPort);
    const b = await TestClient.connect(rig.gatewayPort);
    const readyB = await b.waitFor(isType("ready"));
    await a.waitFor(isType("ready"));

    b.close();

    const offline = await a.waitFor(
      (e): e is { type: "userOffline"; userId: string } =>
        isType("userOffline")(e) && (e as any).userId === (readyB as any).userId,
    );
    assert.equal(offline.userId, (readyB as any).userId);

    a.close();
  } finally {
    await teardown(rig);
  }
});

test("reconnect: a client can disconnect and open a fresh session that works normally", async () => {
  const rig = await setup();
  try {
    const first = await TestClient.connect(rig.gatewayPort);
    await first.waitFor(isType("ready"));
    first.close();

    // Simulate the browser's reconnect logic opening a brand new socket.
    const second = await TestClient.connect(rig.gatewayPort);
    const ready = await second.waitFor(isType("ready"));
    assert.ok((ready as any).userId);
    assert.ok((ready as any).username.startsWith("User"));

    const bystander = await TestClient.connect(rig.gatewayPort);
    await bystander.waitFor(isType("ready"));
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

test("duplicate nickname request is rejected via the real backend uniqueness check", async () => {
  const rig = await setup();
  try {
    const a = await TestClient.connect(rig.gatewayPort);
    const b = await TestClient.connect(rig.gatewayPort);
    await a.waitFor(isType("ready"));
    await b.waitFor(isType("ready"));

    a.send({ type: "setNickname", nickname: "shared-name" });
    await a.waitFor(
      (e): e is { type: "userUpdate"; user: { username: string } } =>
        isType("userUpdate")(e) && (e as any).user?.username === "shared-name",
    );

    b.send({ type: "setNickname", nickname: "shared-name" });
    const err = await b.waitFor(isType("error"));
    assert.equal((err as any).code, "NICK_TAKEN");

    a.close();
    b.close();
  } finally {
    await teardown(rig);
  }
});

test("nickname change is broadcast to other users exactly once", async () => {
  const rig = await setup();
  try {
    const a = await TestClient.connect(rig.gatewayPort);
    const b = await TestClient.connect(rig.gatewayPort);
    await a.waitFor(isType("ready"));
    await b.waitFor(isType("ready"));

    a.send({ type: "setNickname", nickname: "renamed-alice" });
    await new Promise((r) => setTimeout(r, 300)); // let it fully propagate

    const updatesSeenByB = b.events.filter(
      (e): e is { type: "userUpdate"; user: { username: string } } =>
        isType("userUpdate")(e) && (e as any).user?.username === "renamed-alice",
    );
    assert.equal(updatesSeenByB.length, 1, "expected exactly one userUpdate broadcast for the rename");

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
    await a.waitFor(isType("ready"));

    a.send({ type: "sendMessage", target: { kind: "public" }, text: "x".repeat(20000) });
    // still usable afterwards: gateway must not crash or wedge the connection
    a.send({ type: "sendMessage", target: { kind: "public" }, text: "still alive" });

    const b = await TestClient.connect(rig.gatewayPort);
    await b.waitFor(isType("ready"));
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
    await a.waitFor(isType("ready"));
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
    await a.waitFor(isType("ready"));
    a.send({ type: "sendMessage", target: { kind: "public" }, text: "" }); // empty text is invalid
    const err = await a.waitFor(isType("error"));
    assert.equal((err as any).code, "BAD_MESSAGE");
    a.close();
  } finally {
    await teardown(rig);
  }
});

test("gateway reports BACKEND_UNAVAILABLE cleanly when the backend isn't reachable", async () => {
  const { gatewayPort } = allocatePortPair();
  const unreachableBackendPort = 1; // nothing listens here
  const gateway = startGateway(defaultTestConfig(unreachableBackendPort, gatewayPort));
  await waitForPort(gatewayPort);
  try {
    const a = await TestClient.connect(gatewayPort);
    // Must attach the close listener before awaiting anything else --
    // the gateway closes the socket immediately after sending the
    // error, so waiting until after waitFor() (which polls with a
    // delay) can miss the event entirely and hang forever.
    const closed = new Promise<void>((resolve) => a.ws.once("close", () => resolve()));
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
    await a.waitFor(isType("ready"));

    const closed = new Promise<void>((resolve) => a.ws.once("close", () => resolve()));
    await rig.backend.stop(); // graceful SHUTDOWN, then the process exits

    await closed; // gateway must notice and close the WS rather than hang
  } finally {
    await rig.gateway.close();
  }
});
