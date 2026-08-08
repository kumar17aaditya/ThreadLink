/**
 * Persistence layer: a single local SQLite database file (via Node's
 * built-in node:sqlite -- experimental but functional, and avoids
 * pulling in a native-compiled dependency like better-sqlite3 for
 * what this project needs). One file, no separate database server;
 * this is intentionally the simplest storage that satisfies "survive
 * logout, disconnect, and gateway/server restart."
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { logger } from "./logger.js";

export type Db = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('public', 'direct', 'group')),
  title TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  sender_id TEXT,
  sender_username TEXT,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_conversation_members_user ON conversation_members(user_id);
`;

export function openDatabase(filePath: string): Db {
  const dir = path.dirname(filePath);
  if (dir && dir !== "." && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new DatabaseSync(filePath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  // The public conversation always exists; every other row is created
  // on demand (first DM, or explicit group creation).
  db.prepare(
    "INSERT OR IGNORE INTO conversations (id, kind, title, created_at) VALUES ('public', 'public', 'Public Chat', ?)",
  ).run(new Date().toISOString());
  logger.info(`database ready at ${filePath}`);
  return db;
}
