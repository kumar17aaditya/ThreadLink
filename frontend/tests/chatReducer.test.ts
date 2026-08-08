import { test } from "node:test";
import assert from "node:assert/strict";
import { chatReducer, createInitialState, type ChatState } from "@/context/chatState";
import { PUBLIC_CONVERSATION_ID } from "@/types/chat";

function ready(state: ChatState, userId: string, username: string, extraUsers: { id: string; username: string }[] = []) {
  return chatReducer(state, {
    type: "READY",
    userId,
    username,
    users: [{ id: userId, username, presence: "online" }, ...extraUsers.map((u) => ({ ...u, presence: "online" as const }))],
    conversations: [],
  });
}

test("initial state has only the public conversation, no active user", () => {
  const state = createInitialState();
  assert.equal(state.userId, null);
  assert.equal(Object.keys(state.conversations).length, 1);
  assert.ok(state.conversations[PUBLIC_CONVERSATION_ID]);
});

test("READY populates identity, roster, and the public conversation's membership", () => {
  const state = ready(createInitialState(), "u1", "alice", [{ id: "u2", username: "bob" }]);
  assert.equal(state.userId, "u1");
  assert.equal(state.nickname, "alice");
  assert.equal(Object.keys(state.users).length, 2);
  assert.deepEqual(new Set(state.conversations[PUBLIC_CONVERSATION_ID]!.memberIds), new Set(["u1", "u2"]));
});

test("USER_UPDATE for another user adds/updates them without touching own identity", () => {
  let state = ready(createInitialState(), "u1", "alice");
  state = chatReducer(state, { type: "USER_UPDATE", user: { id: "u2", username: "bob", presence: "online" } });
  assert.equal(state.users["u2"]!.nickname, "bob");
  assert.equal(state.nickname, "alice"); // unaffected
});

test("USER_UPDATE for self updates own nickname and presence", () => {
  let state = ready(createInitialState(), "u1", "alice");
  state = chatReducer(state, { type: "USER_UPDATE", user: { id: "u1", username: "alice2", presence: "away" } });
  assert.equal(state.nickname, "alice2");
  assert.equal(state.presence, "away");
});

test("USER_OFFLINE removes the user from the roster and public membership", () => {
  let state = ready(createInitialState(), "u1", "alice", [{ id: "u2", username: "bob" }]);
  state = chatReducer(state, { type: "USER_OFFLINE", userId: "u2" });
  assert.equal(state.users["u2"], undefined);
  assert.ok(!state.conversations[PUBLIC_CONVERSATION_ID]!.memberIds!.includes("u2"));
});

test("CONVERSATION_CREATED (direct) records peerId as the non-self member", () => {
  let state = ready(createInitialState(), "u1", "alice", [{ id: "u2", username: "bob" }]);
  state = chatReducer(state, {
    type: "CONVERSATION_CREATED",
    conversation: { id: "direct:u1:u2", kind: "direct", title: "", memberIds: ["u1", "u2"] },
  });
  const conv = state.conversations["direct:u1:u2"];
  assert.ok(conv);
  assert.equal(conv!.peerId, "u2");
});

test("CONVERSATION_CREATED preserves already-received messages when the summary arrives afterward", () => {
  let state = ready(createInitialState(), "u1", "alice", [{ id: "u2", username: "bob" }]);
  state = chatReducer(state, {
    type: "MESSAGE_RECEIVED",
    message: {
      id: "m1",
      conversationId: "direct:u1:u2",
      kind: "chat",
      senderId: "u2",
      senderUsername: "bob",
      text: "hi",
      timestamp: new Date().toISOString(),
    },
  });
  assert.equal(state.conversations["direct:u1:u2"]!.messages.length, 1);

  state = chatReducer(state, {
    type: "CONVERSATION_CREATED",
    conversation: { id: "direct:u1:u2", kind: "direct", title: "", memberIds: ["u1", "u2"] },
  });
  assert.equal(state.conversations["direct:u1:u2"]!.messages.length, 1, "message should not be lost");
});

test("MESSAGE_RECEIVED marks isOwn correctly and increments unread only for inactive conversations", () => {
  let state = ready(createInitialState(), "u1", "alice", [{ id: "u2", username: "bob" }]);

  state = chatReducer(state, {
    type: "MESSAGE_RECEIVED",
    message: {
      id: "m1",
      conversationId: PUBLIC_CONVERSATION_ID,
      kind: "chat",
      senderId: "u1",
      senderUsername: "alice",
      text: "hello",
      timestamp: new Date().toISOString(),
    },
  });
  const own = state.conversations[PUBLIC_CONVERSATION_ID]!.messages[0]!;
  assert.equal(own.isOwn, true);
  assert.equal(state.conversations[PUBLIC_CONVERSATION_ID]!.unreadCount, 0, "active conversation should not accrue unread");

  state = chatReducer(state, { type: "SET_ACTIVE_CONVERSATION", conversationId: PUBLIC_CONVERSATION_ID });
  state = chatReducer(state, {
    type: "CONVERSATION_CREATED",
    conversation: { id: "direct:u1:u2", kind: "direct", title: "", memberIds: ["u1", "u2"] },
  });
  state = chatReducer(state, {
    type: "MESSAGE_RECEIVED",
    message: {
      id: "m2",
      conversationId: "direct:u1:u2",
      kind: "chat",
      senderId: "u2",
      senderUsername: "bob",
      text: "hey",
      timestamp: new Date().toISOString(),
    },
  });
  assert.equal(state.conversations["direct:u1:u2"]!.unreadCount, 1, "inactive conversation should accrue unread");
});

test("SET_ACTIVE_CONVERSATION clears unread for that conversation", () => {
  let state = ready(createInitialState(), "u1", "alice", [{ id: "u2", username: "bob" }]);
  state = chatReducer(state, {
    type: "CONVERSATION_CREATED",
    conversation: { id: "direct:u1:u2", kind: "direct", title: "", memberIds: ["u1", "u2"] },
  });
  state = chatReducer(state, {
    type: "MESSAGE_RECEIVED",
    message: {
      id: "m1",
      conversationId: "direct:u1:u2",
      kind: "chat",
      senderId: "u2",
      senderUsername: "bob",
      text: "hey",
      timestamp: new Date().toISOString(),
    },
  });
  assert.equal(state.conversations["direct:u1:u2"]!.unreadCount, 1);
  state = chatReducer(state, { type: "SET_ACTIVE_CONVERSATION", conversationId: "direct:u1:u2" });
  assert.equal(state.conversations["direct:u1:u2"]!.unreadCount, 0);
});

test("pendingGroupCreation auto-selects the newly created group exactly once", () => {
  let state = ready(createInitialState(), "u1", "alice", [{ id: "u2", username: "bob" }]);
  state = chatReducer(state, { type: "MARK_PENDING_GROUP_CREATION" });
  state = chatReducer(state, {
    type: "CONVERSATION_CREATED",
    conversation: { id: "group:abc", kind: "group", title: "Engineering", memberIds: ["u1", "u2"] },
  });
  assert.equal(state.activeConversationId, "group:abc");
  assert.equal(state.pendingGroupCreation, false);

  // A second, unrelated group I'm added to afterward should NOT hijack the active conversation.
  state = chatReducer(state, {
    type: "CONVERSATION_CREATED",
    conversation: { id: "group:xyz", kind: "group", title: "Random", memberIds: ["u1", "u2"] },
  });
  assert.equal(state.activeConversationId, "group:abc");
});

test("ERROR_MESSAGE appends a visible error message into the target conversation", () => {
  let state = ready(createInitialState(), "u1", "alice");
  state = chatReducer(state, {
    type: "ERROR_MESSAGE",
    code: "USER_NOT_FOUND",
    message: "That user is not currently online.",
    conversationId: PUBLIC_CONVERSATION_ID,
  });
  const last = state.conversations[PUBLIC_CONVERSATION_ID]!.messages.at(-1)!;
  assert.equal(last.kind, "error");
  assert.equal(state.lastError, "That user is not currently online.");
});

test("RESET_CHAT clears identity/users/conversations back to just public", () => {
  let state = ready(createInitialState(), "u1", "alice", [{ id: "u2", username: "bob" }]);
  state = chatReducer(state, { type: "RESET_CHAT" });
  assert.equal(state.userId, null);
  assert.equal(Object.keys(state.users).length, 0);
  assert.equal(Object.keys(state.conversations).length, 1);
});
