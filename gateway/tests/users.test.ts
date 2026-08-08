import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../src/db.js";
import { UserStore } from "../src/users.js";

function freshStore() {
  return new UserStore(openDatabase(":memory:"));
}

test("register creates a user with a stable id", async () => {
  const store = freshStore();
  const user = await store.register("alice", "password123");
  assert.ok(user.id);
  assert.equal(user.username, "alice");
});

test("register rejects a duplicate username", async () => {
  const store = freshStore();
  await store.register("alice", "password123");
  await assert.rejects(() => store.register("alice", "different-password"));
});

test("register rejects an invalid username", async () => {
  const store = freshStore();
  await assert.rejects(() => store.register("has spaces", "password123"));
  await assert.rejects(() => store.register("", "password123"));
});

test("register rejects a too-short password", async () => {
  const store = freshStore();
  await assert.rejects(() => store.register("bob", "short"));
});

test("login succeeds with correct credentials and returns the same stable id across calls", async () => {
  const store = freshStore();
  const registered = await store.register("carol", "correct-password");
  const loggedIn = await store.login("carol", "correct-password");
  assert.ok(loggedIn);
  assert.equal(loggedIn!.id, registered.id);
});

test("login fails with wrong password", async () => {
  const store = freshStore();
  await store.register("dave", "correct-password");
  const result = await store.login("dave", "wrong-password");
  assert.equal(result, null);
});

test("login fails for an unknown username", async () => {
  const store = freshStore();
  const result = await store.login("nobody", "whatever123");
  assert.equal(result, null);
});

test("findById and findByUsername return the same account", async () => {
  const store = freshStore();
  const user = await store.register("erin", "password123");
  assert.deepEqual({ ...store.findById(user.id) }, user);
  assert.deepEqual({ ...store.findByUsername("erin") }, user);
});

test("rename changes the username but keeps the same id", async () => {
  const store = freshStore();
  const user = await store.register("frank", "password123");
  store.rename(user.id, "frankie");
  assert.equal(store.findById(user.id)!.username, "frankie");
  assert.equal(store.findByUsername("frank"), undefined);
});

test("rename rejects a collision with another account's username", async () => {
  const store = freshStore();
  const a = await store.register("grace", "password123");
  await store.register("henry", "password123");
  assert.throws(() => store.rename(a.id, "henry"));
});
