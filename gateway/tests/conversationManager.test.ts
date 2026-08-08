import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../src/db.js";
import { ConversationManager, directConversationId, PUBLIC_CONVERSATION_ID } from "../src/conversationManager.js";

function freshManager() {
  return new ConversationManager(openDatabase(":memory:"));
}

test("directConversationId is order-independent", () => {
  assert.equal(directConversationId("a", "b"), directConversationId("b", "a"));
});

test("publicConversation reflects the given online user ids", () => {
  const cm = freshManager();
  const pub = cm.publicConversation(["u1", "u2"]);
  assert.equal(pub.id, PUBLIC_CONVERSATION_ID);
  assert.equal(pub.kind, "public");
  assert.deepEqual(pub.memberIds, ["u1", "u2"]);
});

test("ensureDirect creates and then reuses the same conversation", () => {
  const cm = freshManager();
  assert.equal(cm.hasDirect(directConversationId("u1", "u2")), false);
  const first = cm.ensureDirect("u1", "u2");
  assert.equal(cm.hasDirect(directConversationId("u1", "u2")), true);
  const second = cm.ensureDirect("u2", "u1"); // reversed order
  assert.equal(first.id, second.id);
});

test("createGroup stores membership and conversationsFor reflects it", () => {
  const cm = freshManager();
  const group = cm.createGroup("Engineering", ["u1", "u2", "u3"]);
  assert.equal(group.kind, "group");
  assert.equal(group.title, "Engineering");

  const forU1 = cm.conversationsFor("u1");
  assert.equal(forU1.length, 1);
  assert.equal(forU1[0]!.id, group.id);

  const forOutsider = cm.conversationsFor("someone-else");
  assert.equal(forOutsider.length, 0);
});

test("getGroup returns undefined for an unknown id", () => {
  const cm = freshManager();
  assert.equal(cm.getGroup("group:does-not-exist"), undefined);
});

test("conversationsFor includes both direct and group conversations", () => {
  const cm = freshManager();
  cm.ensureDirect("u1", "u2");
  cm.createGroup("G", ["u1", "u3"]);
  const forU1 = cm.conversationsFor("u1");
  const kinds = forU1.map((c) => c.kind).sort();
  assert.deepEqual(kinds, ["direct", "group"]);
});

test("group and direct membership survive a fresh ConversationManager over the same database (simulated restart)", () => {
  const db = openDatabase(":memory:");
  const first = new ConversationManager(db);
  const group = first.createGroup("Persistent Team", ["u1", "u2"]);
  first.ensureDirect("u1", "u3");

  // A brand-new manager instance over the SAME db handle, exactly as
  // happens when the gateway process restarts and reopens the file.
  const second = new ConversationManager(db);
  const forU1 = second.conversationsFor("u1");
  const kinds = forU1.map((c) => c.kind).sort();
  assert.deepEqual(kinds, ["direct", "group"]);
  assert.ok(forU1.some((c) => c.id === group.id && c.title === "Persistent Team"));
});
