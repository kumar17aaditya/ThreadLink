import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../src/auth.js";

test("hashPassword never stores the plaintext password", async () => {
  const record = await hashPassword("correct horse battery staple");
  assert.ok(!record.hash.includes("correct horse"));
  assert.match(record.hash, /^[0-9a-f]+$/);
  assert.match(record.salt, /^[0-9a-f]+$/);
});

test("verifyPassword accepts the correct password", async () => {
  const record = await hashPassword("hunter22");
  assert.equal(await verifyPassword("hunter22", record), true);
});

test("verifyPassword rejects an incorrect password", async () => {
  const record = await hashPassword("hunter22");
  assert.equal(await verifyPassword("wrong-password", record), false);
});

test("two hashes of the same password use different salts and differ", async () => {
  const a = await hashPassword("same-password");
  const b = await hashPassword("same-password");
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.hash, b.hash);
  // Both still verify correctly against their own record.
  assert.equal(await verifyPassword("same-password", a), true);
  assert.equal(await verifyPassword("same-password", b), true);
});
