import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBackendLine } from "../src/backendMessages.js";

test("parses WELCOME", () => {
  const e = parseBackendLine("WELCOME User1");
  assert.deepEqual(e, { type: "welcome", nickname: "User1" });
});

test("parses MSG with a multi-word message", () => {
  const e = parseBackendLine("MSG alice hello there everyone");
  assert.deepEqual(e, { type: "msg", sender: "alice", text: "hello there everyone" });
});

test("parses PRIV and PRIV_SENT", () => {
  assert.deepEqual(parseBackendLine("PRIV bob secret text"), {
    type: "priv",
    sender: "bob",
    text: "secret text",
  });
  assert.deepEqual(parseBackendLine("PRIV_SENT carol secret text"), {
    type: "privSent",
    recipient: "carol",
    text: "secret text",
  });
});

test("parses NICK", () => {
  assert.deepEqual(parseBackendLine("NICK old new"), { type: "nick", oldNick: "old", newNick: "new" });
});

test("parses LIST with names", () => {
  assert.deepEqual(parseBackendLine("LIST 3 alice bob carol"), {
    type: "list",
    count: 3,
    names: ["alice", "bob", "carol"],
  });
});

test("parses LIST with zero users", () => {
  assert.deepEqual(parseBackendLine("LIST 0"), { type: "list", count: 0, names: [] });
});

test("parses ERR with a code and free text", () => {
  assert.deepEqual(parseBackendLine("ERR NICK_TAKEN Nickname 'bob' is already in use"), {
    type: "err",
    code: "NICK_TAKEN",
    text: "Nickname 'bob' is already in use",
  });
});

test("parses SYS free text", () => {
  assert.deepEqual(parseBackendLine("SYS alice has joined."), { type: "sys", text: "alice has joined." });
});

test("falls back to unknown for an unrecognized type", () => {
  const e = parseBackendLine("SOMETHING_NEW foo bar");
  assert.deepEqual(e, { type: "unknown", raw: "SOMETHING_NEW foo bar" });
});
