import { test } from "node:test";
import assert from "node:assert/strict";
import { ConversationManager, directConversationId, PUBLIC_CONVERSATION_ID } from "../src/conversationManager.js";

test("directConversationId is order-independent", () => {
  assert.equal(directConversationId("a", "b"), directConversationId("b", "a"));
});

test("publicConversation reflects the given online user ids", () => {
  const cm = new ConversationManager();
  const pub = cm.publicConversation(["u1", "u2"]);
  assert.equal(pub.id, PUBLIC_CONVERSATION_ID);
  assert.equal(pub.kind, "public");
  assert.deepEqual(pub.memberIds, ["u1", "u2"]);
});

test("ensureDirect creates and then reuses the same conversation", () => {
  const cm = new ConversationManager();
  assert.equal(cm.hasDirect(directConversationId("u1", "u2")), false);
  const first = cm.ensureDirect("u1", "u2");
  assert.equal(cm.hasDirect(directConversationId("u1", "u2")), true);
  const second = cm.ensureDirect("u2", "u1"); // reversed order
  assert.equal(first.id, second.id);
});

test("createGroup stores membership and conversationsFor reflects it", () => {
  const cm = new ConversationManager();
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
  const cm = new ConversationManager();
  assert.equal(cm.getGroup("group:does-not-exist"), undefined);
});

test("forgetUser removes a user from all of their groups", () => {
  const cm = new ConversationManager();
  const group = cm.createGroup("Team", ["u1", "u2"]);
  cm.forgetUser("u1");
  const stillMember = cm.getGroup(group.id)!.memberIds.has("u1");
  const otherStillMember = cm.getGroup(group.id)!.memberIds.has("u2");
  assert.equal(stillMember, false);
  assert.equal(otherStillMember, true);
});

test("conversationsFor includes both direct and group conversations", () => {
  const cm = new ConversationManager();
  cm.ensureDirect("u1", "u2");
  cm.createGroup("G", ["u1", "u3"]);
  const forU1 = cm.conversationsFor("u1");
  const kinds = forU1.map((c) => c.kind).sort();
  assert.deepEqual(kinds, ["direct", "group"]);
});
