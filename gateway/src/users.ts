import { randomUUID } from "node:crypto";
import type { Db } from "./db.js";
import { hashPassword, verifyPassword } from "./auth.js";

export interface UserRecord {
  id: string;
  username: string;
}

const USERNAME_RE = /^[A-Za-z0-9_-]{1,24}$/;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 256;

export function validateUsername(username: string): string | null {
  if (!USERNAME_RE.test(username)) {
    return "Username must be 1-24 characters: letters, digits, '_' or '-' only.";
  }
  return null;
}

export function validatePassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > MAX_PASSWORD_LENGTH) return "Password is too long.";
  return null;
}

export class UserStore {
  constructor(private readonly db: Db) {}

  findByUsername(username: string): UserRecord | undefined {
    const row = this.db
      .prepare("SELECT id, username FROM users WHERE username = ?")
      .get(username) as { id: string; username: string } | undefined;
    return row;
  }

  findById(id: string): UserRecord | undefined {
    const row = this.db
      .prepare("SELECT id, username FROM users WHERE id = ?")
      .get(id) as { id: string; username: string } | undefined;
    return row;
  }

  /** Registers a new account. Throws a plain Error with a user-facing
   * message on validation failure or username collision; never
   * includes the password or its hash in any error or log line. */
  async register(username: string, password: string): Promise<UserRecord> {
    const usernameError = validateUsername(username);
    if (usernameError) throw new Error(usernameError);
    const passwordError = validatePassword(password);
    if (passwordError) throw new Error(passwordError);
    if (this.findByUsername(username)) {
      throw new Error("That username is already taken.");
    }

    const { hash, salt } = await hashPassword(password);
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO users (id, username, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(id, username, hash, salt, new Date().toISOString());
    return { id, username };
  }

  /** Verifies credentials. Returns the user record on success, or
   * null on any failure (unknown username or wrong password) --
   * deliberately not distinguishing the two in the returned value to
   * avoid username enumeration via response shape. */
  async login(username: string, password: string): Promise<UserRecord | null> {
    const row = this.db
      .prepare("SELECT id, username, password_hash, password_salt FROM users WHERE username = ?")
      .get(username) as
      | { id: string; username: string; password_hash: string; password_salt: string }
      | undefined;
    if (!row) return null;
    const ok = await verifyPassword(password, { hash: row.password_hash, salt: row.password_salt });
    if (!ok) return null;
    return { id: row.id, username: row.username };
  }

  /** Renames a user's account (mirrors the existing /nick flow, now
   * persisted). Throws on collision, same as register(). */
  rename(userId: string, newUsername: string): void {
    const usernameError = validateUsername(newUsername);
    if (usernameError) throw new Error(usernameError);
    const existing = this.findByUsername(newUsername);
    if (existing && existing.id !== userId) {
      throw new Error("That username is already taken.");
    }
    this.db.prepare("UPDATE users SET username = ? WHERE id = ?").run(newUsername, userId);
  }
}
