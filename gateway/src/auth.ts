/**
 * Password hashing via Node's built-in crypto.scrypt. No bcrypt/argon2
 * dependency needed -- scrypt is a well-regarded, memory-hard KDF
 * already in the standard library, which is all this project needs.
 * Never logs or returns a password or its hash to any caller outside
 * this module.
 */
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

export interface PasswordRecord {
  hash: string; // hex
  salt: string; // hex
}

export async function hashPassword(password: string): Promise<PasswordRecord> {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return { hash: derived.toString("hex"), salt: salt.toString("hex") };
}

export async function verifyPassword(password: string, record: PasswordRecord): Promise<boolean> {
  const salt = Buffer.from(record.salt, "hex");
  const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  const expected = Buffer.from(record.hash, "hex");
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
