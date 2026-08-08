import { test } from "node:test";
import assert from "node:assert/strict";
import { validateClientMessage } from "../src/clientProtocol.js";

test("accepts a valid setNickname message", () => {
  const r = validateClientMessage({ type: "setNickname", nickname: "alice" });
  assert.equal(r.ok, true);
});

test("rejects setNickname with an empty nickname", () => {
  const r = validateClientMessage({ type: "setNickname", nickname: "" });
  assert.equal(r.ok, false);
});

test("rejects setNickname with an over-length nickname", () => {
  const r = validateClientMessage({ type: "setNickname", nickname: "x".repeat(100) });
  assert.equal(r.ok, false);
});

test("accepts a valid public sendMessage", () => {
  const r = validateClientMessage({ type: "sendMessage", target: { kind: "public" }, text: "hi" });
  assert.equal(r.ok, true);
});

test("accepts a valid direct sendMessage", () => {
  const r = validateClientMessage({
    type: "sendMessage",
    target: { kind: "direct", peerId: "abc-123" },
    text: "hi",
  });
  assert.equal(r.ok, true);
});

test("rejects direct sendMessage missing peerId", () => {
  const r = validateClientMessage({ type: "sendMessage", target: { kind: "direct" }, text: "hi" });
  assert.equal(r.ok, false);
});

test("rejects sendMessage with empty text", () => {
  const r = validateClientMessage({ type: "sendMessage", target: { kind: "public" }, text: "" });
  assert.equal(r.ok, false);
});

test("rejects sendMessage with oversized text", () => {
  const r = validateClientMessage({
    type: "sendMessage",
    target: { kind: "public" },
    text: "x".repeat(5000),
  });
  assert.equal(r.ok, false);
});

test("accepts a valid createGroup message", () => {
  const r = validateClientMessage({ type: "createGroup", name: "Engineering", memberIds: ["a", "b"] });
  assert.equal(r.ok, true);
});

test("rejects createGroup with no members", () => {
  const r = validateClientMessage({ type: "createGroup", name: "Empty", memberIds: [] });
  assert.equal(r.ok, false);
});

test("rejects createGroup with a non-string member id", () => {
  const r = validateClientMessage({ type: "createGroup", name: "Bad", memberIds: [123] });
  assert.equal(r.ok, false);
});

test("accepts valid setPresence values", () => {
  assert.equal(validateClientMessage({ type: "setPresence", presence: "online" }).ok, true);
  assert.equal(validateClientMessage({ type: "setPresence", presence: "away" }).ok, true);
});

test("rejects an invalid setPresence value", () => {
  const r = validateClientMessage({ type: "setPresence", presence: "offline" });
  assert.equal(r.ok, false);
});

test("accepts requestState", () => {
  assert.equal(validateClientMessage({ type: "requestState" }).ok, true);
});

test("rejects an unknown message type", () => {
  const r = validateClientMessage({ type: "doSomethingWeird" });
  assert.equal(r.ok, false);
});

test("rejects non-object input", () => {
  assert.equal(validateClientMessage("just a string").ok, false);
  assert.equal(validateClientMessage(null).ok, false);
  assert.equal(validateClientMessage(42).ok, false);
});
