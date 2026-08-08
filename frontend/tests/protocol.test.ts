import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeOutbound, parseInbound } from "@/types/protocol";
import { directConversationId } from "@/types/chat";

test("encodeOutbound produces valid JSON matching the message shape", () => {
  const encoded = encodeOutbound({ type: "sendMessage", target: { kind: "public" }, text: "hi" });
  assert.deepEqual(JSON.parse(encoded), { type: "sendMessage", target: { kind: "public" }, text: "hi" });
});

test("parseInbound round-trips a well-formed server message", () => {
  const raw = JSON.stringify({ type: "userOffline", userId: "u1" });
  const parsed = parseInbound(raw);
  assert.deepEqual(parsed, { type: "userOffline", userId: "u1" });
});

test("parseInbound returns null for invalid JSON without throwing", () => {
  assert.equal(parseInbound("{ not json"), null);
});

test("parseInbound returns null for JSON with no 'type' field", () => {
  assert.equal(parseInbound(JSON.stringify({ foo: "bar" })), null);
});

test("directConversationId matches the gateway's algorithm (sorted, colon-joined, 'direct:' prefixed)", () => {
  assert.equal(directConversationId("b", "a"), "direct:a:b");
  assert.equal(directConversationId("a", "b"), directConversationId("b", "a"));
});
