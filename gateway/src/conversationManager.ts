import { randomUUID } from "node:crypto";
import type { ConversationSummary } from "./clientProtocol.js";

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
 */
export class ConversationManager {
  private directs = new Map<string, { memberIds: [string, string] }>();
  private groups = new Map<string, GroupConversation>();

  publicConversation(onlineUserIds: string[]): ConversationSummary {
    return {
      id: PUBLIC_CONVERSATION_ID,
      kind: "public",
      title: "Public Chat",
      memberIds: onlineUserIds,
    };
  }

  /** Ensures a direct conversation record exists for this pair and returns it. */
  ensureDirect(a: string, b: string): ConversationSummary {
    const id = directConversationId(a, b);
    if (!this.directs.has(id)) {
      this.directs.set(id, { memberIds: [a, b] });
    }
    return { id, kind: "direct", title: "", memberIds: [a, b] };
  }

  hasDirect(id: string): boolean {
    return this.directs.has(id);
  }

  createGroup(name: string, memberIds: string[]): ConversationSummary {
    const id = `group:${randomUUID()}`;
    this.groups.set(id, { id, name, memberIds: new Set(memberIds) });
    return { id, kind: "group", title: name, memberIds: [...memberIds] };
  }

  getGroup(id: string): GroupConversation | undefined {
    return this.groups.get(id);
  }

  /** All conversations (direct + group) a given user is currently part of. */
  conversationsFor(userId: string): ConversationSummary[] {
    const result: ConversationSummary[] = [];
    for (const [id, dm] of this.directs) {
      if (dm.memberIds.includes(userId)) {
        result.push({ id, kind: "direct", title: "", memberIds: dm.memberIds });
      }
    }
    for (const group of this.groups.values()) {
      if (group.memberIds.has(userId)) {
        result.push({
          id: group.id,
          kind: "group",
          title: group.name,
          memberIds: [...group.memberIds],
        });
      }
    }
    return result;
  }

  /** Drops any membership records for a user id whose session ended.
   * Direct conversations are left in place (the peer may still see
   * history in their own view); the departed id simply won't resolve
   * to an online session for delivery purposes any more. */
  forgetUser(userId: string): void {
    for (const group of this.groups.values()) {
      group.memberIds.delete(userId);
    }
  }
}
