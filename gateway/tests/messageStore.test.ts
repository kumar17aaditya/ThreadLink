import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../src/db.js";
import { MessageStore } from "../src/messageStore.js";
import { ConversationManager } from "../src/conversationManager.js";

test("append persists a message and assigns id/timestamp", () => {
  const store = new MessageStore(openDatabase(":memory:"));
  const msg = store.append({
    conversationId: "public",
    kind: "chat",
    senderId: "u1",
    senderUsername: "alice",
    text: "hello",
  });
  assert.ok(msg.id);
  assert.ok(msg.timestamp);
  assert.equal(msg.text, "hello");
});

test("historyForUser includes public messages regardless of membership rows", () => {
  const store = new MessageStore(openDatabase(":memory:"));
  store.append({ conversationId: "public", kind: "chat", senderId: "u1", senderUsername: "alice", text: "hi all" });
  const history = store.historyForUser("u2"); // u2 has no explicit membership in "public"
  assert.equal(history.length, 1);
  assert.equal(history[0]!.text, "hi all");
});

test("historyForUser only includes conversations the user is a member of", () => {
  const db = openDatabase(":memory:");
  const conversations = new ConversationManager(db);
  const store = new MessageStore(db);

  const dmAB = conversations.ensureDirect("u1", "u2");
  conversations.ensureDirect("u1", "u3"); // a DM u2 is not part of

  store.append({ conversationId: dmAB.id, kind: "chat", senderId: "u1", senderUsername: "alice", text: "hey u2" });
  store.append({
    conversationId: conversations.ensureDirect("u1", "u3").id,
    kind: "chat",
    senderId: "u1",
    senderUsername: "alice",
    text: "hey u3",
  });

  const historyForU2 = store.historyForUser("u2");
  assert.equal(historyForU2.length, 1);
  assert.equal(historyForU2[0]!.text, "hey u2");
});

test("historyForUser returns messages in chronological order", () => {
  const store = new MessageStore(openDatabase(":memory:"));
  store.append({
    conversationId: "public",
    kind: "chat",
    senderId: "u1",
    senderUsername: "alice",
    text: "first",
    timestamp: "2026-01-01T00:00:00.000Z",
  });
  store.append({
    conversationId: "public",
    kind: "chat",
    senderId: "u1",
    senderUsername: "alice",
    text: "second",
    timestamp: "2026-01-01T00:00:01.000Z",
  });
  const history = store.historyForUser("u1");
  assert.deepEqual(history.map((m) => m.text), ["first", "second"]);
});

test("message history survives a fresh MessageStore over the same database (simulated restart)", () => {
  const db = openDatabase(":memory:");
  const first = new MessageStore(db);
  first.append({ conversationId: "public", kind: "chat", senderId: "u1", senderUsername: "alice", text: "still here?" });

  const second = new MessageStore(db);
  const history = second.historyForUser("u1");
  assert.equal(history.length, 1);
  assert.equal(history[0]!.text, "still here?");
});
