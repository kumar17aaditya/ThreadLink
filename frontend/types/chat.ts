import type { ConversationKind, Presence } from "@/types/protocol";

export type MessageKind = "chat" | "system" | "error";

export interface User {
  id: string;
  nickname: string;
  presence: Presence;
}

export interface Message {
  id: string;
  kind: MessageKind;
  senderId: string | null;
  sender?: string;
  content: string;
  timestamp: Date;
  isOwn: boolean;
}

export interface Conversation {
  id: string;
  type: ConversationKind;
  title: string;
  /** Set for "direct" conversations: the other participant's user id. */
  peerId?: string;
  /** Set for "group" conversations: current member user ids. */
  memberIds?: string[];
  messages: Message[];
  unreadCount: number;
}

export interface ConnectionSettings {
  gatewayUrl: string;
}

export const PUBLIC_CONVERSATION_ID = "public";

/** Mirrors gateway/src/conversationManager.ts::directConversationId
 * exactly, so the frontend can optimistically open/select a direct
 * conversation before any message has actually been sent (the
 * gateway itself only creates + announces the record lazily, on
 * first send). Keep in sync with the gateway if that algorithm ever
 * changes. */
export function directConversationId(a: string, b: string): string {
  return `direct:${[a, b].sort().join(":")}`;
}
