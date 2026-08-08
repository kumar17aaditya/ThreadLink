import { randomUUID } from "node:crypto";
import type { Db } from "./db.js";
import type { MessageSummary } from "./clientProtocol.js";

interface MessageRow {
  id: string;
  conversation_id: string;
  kind: "chat" | "system";
  sender_id: string | null;
  sender_username: string | null;
  text: string;
  created_at: string;
}

function toSummary(row: MessageRow): MessageSummary {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    kind: row.kind,
    senderId: row.sender_id,
    senderUsername: row.sender_username,
    text: row.text,
    timestamp: row.created_at,
  };
}

export class MessageStore {
  constructor(private readonly db: Db) {}

  append(message: Omit<MessageSummary, "id" | "timestamp"> & { id?: string; timestamp?: string }): MessageSummary {
    const id = message.id ?? randomUUID();
    const timestamp = message.timestamp ?? new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO messages (id, conversation_id, kind, sender_id, sender_username, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(id, message.conversationId, message.kind, message.senderId, message.senderUsername, message.text, timestamp);
    return { ...message, id, timestamp };
  }

  /** All messages across every conversation `userId` is a member of
   * (their DMs and groups) plus the public conversation, ordered
   * oldest-first -- exactly what a client needs to fully restore its
   * conversation views after login. */
  historyForUser(userId: string): MessageSummary[] {
    const rows = this.db
      .prepare(
        `SELECT m.id, m.conversation_id, m.kind, m.sender_id, m.sender_username, m.text, m.created_at
         FROM messages m
         WHERE m.conversation_id = 'public'
            OR m.conversation_id IN (
              SELECT conversation_id FROM conversation_members WHERE user_id = ?
            )
         ORDER BY m.created_at ASC`,
      )
      .all(userId) as unknown as MessageRow[];
    return rows.map(toSummary);
  }
}
