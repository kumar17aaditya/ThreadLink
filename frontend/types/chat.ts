export type MessageKind = "chat" | "system" | "error" | "private";

export interface User {
  id: string;
  nickname: string;
  isOnline: boolean;
}

export interface Message {
  id: string;
  kind: MessageKind;
  sender?: string;
  content: string;
  timestamp: Date;
  isOwn: boolean;
}

export type ConversationType = "public" | "private";

export interface Conversation {
  id: string;
  type: ConversationType;
  title: string;
  participantNickname?: string;
  messages: Message[];
  unreadCount: number;
}

export interface ConnectionSettings {
  gatewayUrl: string;
  nickname: string;
}

export const PUBLIC_CONVERSATION_ID = "public";

export function privateConversationId(nickname: string): string {
  return `private:${nickname.toLowerCase()}`;
}
