import { randomUUID } from "node:crypto";
import type { Db } from "./db.js";
import type { ConversationSummary } from "./clientProtocol.js";
import type { UserStore } from "./users.js";

export const PUBLIC_CONVERSATION_ID = "public";

interface GroupConversation {
  id: string;
  name: string;
  memberIds: Set<string>;
}

/** Canonical, order-independent id for a direct-message pair. */
export function directConversationId(a: string, b: string): string {
  return `direct:${[a, b].sort().join(":")}`;
}

/**
 * Owns conversation *existence and membership* — real, gateway-side
 * application state, not something the frontend fabricates. The C++
 * backend has no notion of conversations/groups at all (see
 * docs/PROTOCOL.md §6), so this is genuinely new application-layer
 * state, not a duplicate of anything the backend already tracks.
 *
 * Backed by SQLite (db.ts) so that conversation existence and
 * membership survive gateway restarts and are independent of which
 * members are currently online -- unlike the earlier in-memory
 * version, membership here is never cleared on disconnect.
 */
export class ConversationManager {
  /** `userStore` is optional so the class remains easily unit-testable
   * with synthetic ids that don't correspond to real accounts (see
   * tests/conversationManager.test.ts); when present, it's used to
   * resolve a direct conversation's display title to the *other*
   * member's persisted username -- important so a restored DM still
   * shows who it's with even if that person isn't currently online
   * (their live nickname wouldn't be known otherwise). */
  constructor(
    private readonly db: Db,
    private readonly userStore?: UserStore,
  ) {}

  publicConversation(onlineUserIds: string[]): ConversationSummary {
    return {
      id: PUBLIC_CONVERSATION_ID,
      kind: "public",
      title: "Public Chat",
      memberIds: onlineUserIds,
    };
  }

  /** Ensures a direct conversation record exists for this pair (and
   * its membership rows) and returns it. Idempotent. */
  ensureDirect(a: string, b: string): ConversationSummary {
    const id = directConversationId(a, b);
    if (!this.hasDirect(id)) {
      const now = new Date().toISOString();
      this.db
        .prepare("INSERT OR IGNORE INTO conversations (id, kind, title, created_at) VALUES (?, 'direct', '', ?)")
        .run(id, now);
      this.addMember(id, a);
      this.addMember(id, b);
    }
    return { id, kind: "direct", title: "", memberIds: [a, b] };
  }

  hasDirect(id: string): boolean {
    const row = this.db.prepare("SELECT 1 FROM conversations WHERE id = ? AND kind = 'direct'").get(id);
    return row !== undefined;
  }

  createGroup(name: string, memberIds: string[]): ConversationSummary {
    const id = `group:${randomUUID()}`;
    const now = new Date().toISOString();
    this.db
      .prepare("INSERT INTO conversations (id, kind, title, created_at) VALUES (?, 'group', ?, ?)")
      .run(id, name, now);
    for (const memberId of memberIds) this.addMember(id, memberId);
    return { id, kind: "group", title: name, memberIds: [...memberIds] };
  }

  getGroup(id: string): GroupConversation | undefined {
    const conv = this.db
      .prepare("SELECT id, title FROM conversations WHERE id = ? AND kind = 'group'")
      .get(id) as { id: string; title: string } | undefined;
    if (!conv) return undefined;
    const members = this.db
      .prepare("SELECT user_id FROM conversation_members WHERE conversation_id = ?")
      .all(id) as { user_id: string }[];
    return { id: conv.id, name: conv.title, memberIds: new Set(members.map((m) => m.user_id)) };
  }

  /** All conversations (direct + group) a given user is currently part of. */
  conversationsFor(userId: string): ConversationSummary[] {
    const rows = this.db
      .prepare(
        `SELECT c.id, c.kind, c.title
         FROM conversations c
         JOIN conversation_members cm ON cm.conversation_id = c.id
         WHERE cm.user_id = ? AND c.kind IN ('direct', 'group')`,
      )
      .all(userId) as { id: string; kind: "direct" | "group"; title: string }[];

    return rows.map((row) => {
      const memberRows = this.db
        .prepare("SELECT user_id FROM conversation_members WHERE conversation_id = ?")
        .all(row.id) as { user_id: string }[];
      const memberIds = memberRows.map((m) => m.user_id);

      let title = row.title;
      if (row.kind === "direct" && this.userStore) {
        const otherId = memberIds.find((id) => id !== userId);
        title = (otherId && this.userStore.findById(otherId)?.username) || title;
      }

      return { id: row.id, kind: row.kind, title, memberIds };
    });
  }

  private addMember(conversationId: string, userId: string): void {
    this.db
      .prepare("INSERT OR IGNORE INTO conversation_members (conversation_id, user_id) VALUES (?, ?)")
      .run(conversationId, userId);
  }
}
