/**
 * Pure state layer: no React, no JSX, no side effects. Deliberately
 * separated from ChatProvider.tsx (which owns the WebSocket
 * lifecycle and wires this reducer into a React context) so it can
 * be unit-tested directly -- see tests/chatReducer.test.ts.
 */
import { createId } from "@/lib/id";
import { loadConnectionSettings } from "@/lib/storage";
import { PUBLIC_CONVERSATION_ID } from "@/types/chat";
import type { Conversation, ConnectionSettings, Message, User } from "@/types/chat";
import type {
  ConnectionStatus,
  ConversationSummary,
  MessageSummary,
  Presence,
  UserSummary,
} from "@/types/protocol";

export interface ChatState {
  connectionStatus: ConnectionStatus;
  settings: ConnectionSettings;
  userId: string | null;
  nickname: string;
  presence: Presence;
  users: Record<string, User>;
  conversations: Record<string, Conversation>;
  activeConversationId: string;
  sidebarOpen: boolean;
  nicknameModalOpen: boolean;
  newGroupModalOpen: boolean;
  /** True immediately after a createGroup() call, until the resulting
   * conversationCreated event (where we're a member) arrives -- lets
   * the reducer auto-select the group the creator just made without
   * the gateway needing a separate "ack" message type. */
  pendingGroupCreation: boolean;
  lastError: string | null;
  hasConnectedOnce: boolean;
}

export type ChatAction =
  | { type: "SET_STATUS"; status: ConnectionStatus }
  | { type: "SET_SETTINGS"; settings: ConnectionSettings }
  | { type: "READY"; userId: string; username: string; users: UserSummary[]; conversations: ConversationSummary[] }
  | { type: "USER_UPDATE"; user: UserSummary }
  | { type: "USER_OFFLINE"; userId: string }
  | { type: "CONVERSATION_CREATED"; conversation: ConversationSummary }
  | { type: "MESSAGE_RECEIVED"; message: MessageSummary }
  | { type: "ERROR_MESSAGE"; code: string; message: string; conversationId?: string }
  | { type: "SET_ACTIVE_CONVERSATION"; conversationId: string }
  | { type: "SET_SIDEBAR_OPEN"; open: boolean }
  | { type: "SET_NICKNAME_MODAL"; open: boolean }
  | { type: "SET_NEW_GROUP_MODAL"; open: boolean }
  | { type: "MARK_PENDING_GROUP_CREATION" }
  | { type: "SET_ERROR"; message: string | null }
  | { type: "RESET_CHAT" }
  | { type: "MARK_CONNECTED" };

function createPublicConversation(memberIds: string[] = []): Conversation {
  return { id: PUBLIC_CONVERSATION_ID, type: "public", title: "Public Chat", memberIds, messages: [], unreadCount: 0 };
}

function conversationFromSummary(summary: ConversationSummary, selfId: string): Conversation {
  if (summary.kind === "direct") {
    const peerId = summary.memberIds.find((id) => id !== selfId);
    return {
      id: summary.id,
      type: "direct",
      title: "", // resolved at render time from the peer's live nickname
      peerId,
      messages: [],
      unreadCount: 0,
    };
  }
  if (summary.kind === "group") {
    return {
      id: summary.id,
      type: "group",
      title: summary.title,
      memberIds: summary.memberIds,
      messages: [],
      unreadCount: 0,
    };
  }
  return createPublicConversation(summary.memberIds);
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "SET_STATUS":
      return { ...state, connectionStatus: action.status };
    case "SET_SETTINGS":
      return { ...state, settings: action.settings };

    case "READY": {
      const users: Record<string, User> = {};
      for (const u of action.users) users[u.id] = { id: u.id, nickname: u.username, presence: u.presence };

      const conversations: Record<string, Conversation> = {
        [PUBLIC_CONVERSATION_ID]: createPublicConversation(action.users.map((u) => u.id)),
      };
      for (const summary of action.conversations) {
        if (summary.id === PUBLIC_CONVERSATION_ID) continue;
        conversations[summary.id] = conversationFromSummary(summary, action.userId);
      }

      return {
        ...state,
        userId: action.userId,
        nickname: action.username,
        presence: "online",
        users,
        conversations,
        activeConversationId: state.conversations[state.activeConversationId] ? state.activeConversationId : PUBLIC_CONVERSATION_ID,
      };
    }

    case "USER_UPDATE": {
      const user: User = { id: action.user.id, nickname: action.user.username, presence: action.user.presence };
      const isSelf = action.user.id === state.userId;
      const publicConv = state.conversations[PUBLIC_CONVERSATION_ID];
      const publicMemberIds = publicConv?.memberIds ?? [];
      const nextPublicMemberIds = publicMemberIds.includes(user.id) ? publicMemberIds : [...publicMemberIds, user.id];

      return {
        ...state,
        users: { ...state.users, [user.id]: user },
        nickname: isSelf ? user.nickname : state.nickname,
        presence: isSelf ? user.presence : state.presence,
        conversations: publicConv
          ? { ...state.conversations, [PUBLIC_CONVERSATION_ID]: { ...publicConv, memberIds: nextPublicMemberIds } }
          : state.conversations,
      };
    }

    case "USER_OFFLINE": {
      const rest = { ...state.users };
      delete rest[action.userId];
      const publicConv = state.conversations[PUBLIC_CONVERSATION_ID];
      return {
        ...state,
        users: rest,
        conversations: publicConv
          ? {
              ...state.conversations,
              [PUBLIC_CONVERSATION_ID]: {
                ...publicConv,
                memberIds: (publicConv.memberIds ?? []).filter((id) => id !== action.userId),
              },
            }
          : state.conversations,
      };
    }

    case "CONVERSATION_CREATED": {
      if (!state.userId) return state;
      const existing = state.conversations[action.conversation.id];
      const incoming = conversationFromSummary(action.conversation, state.userId);
      const merged: Conversation = existing ? { ...incoming, messages: existing.messages, unreadCount: existing.unreadCount } : incoming;

      const isNewGroupIJustCreated =
        state.pendingGroupCreation &&
        action.conversation.kind === "group" &&
        action.conversation.memberIds.includes(state.userId) &&
        !existing;

      return {
        ...state,
        conversations: { ...state.conversations, [merged.id]: merged },
        activeConversationId: isNewGroupIJustCreated ? merged.id : state.activeConversationId,
        pendingGroupCreation: isNewGroupIJustCreated ? false : state.pendingGroupCreation,
        newGroupModalOpen: isNewGroupIJustCreated ? false : state.newGroupModalOpen,
      };
    }

    case "MESSAGE_RECEIVED": {
      const m = action.message;
      const existing = state.conversations[m.conversationId];
      const conversation: Conversation =
        existing ??
        (m.conversationId === PUBLIC_CONVERSATION_ID
          ? createPublicConversation()
          : { id: m.conversationId, type: "direct", title: m.senderUsername ?? "Unknown", messages: [], unreadCount: 0 });

      const message: Message = {
        id: m.id,
        kind: m.kind,
        senderId: m.senderId,
        sender: m.senderUsername ?? undefined,
        content: m.text,
        timestamp: new Date(m.timestamp),
        isOwn: m.senderId !== null && m.senderId === state.userId,
      };
      const isActive = state.activeConversationId === conversation.id;

      return {
        ...state,
        conversations: {
          ...state.conversations,
          [conversation.id]: {
            ...conversation,
            messages: [...conversation.messages, message],
            unreadCount: isActive ? 0 : conversation.unreadCount + 1,
          },
        },
      };
    }

    case "ERROR_MESSAGE": {
      const conversationId = action.conversationId ?? state.activeConversationId;
      const conversation = state.conversations[conversationId];
      const message: Message = {
        id: createId("err"),
        kind: "error",
        senderId: null,
        content: action.message,
        timestamp: new Date(),
        isOwn: false,
      };
      if (!conversation) return { ...state, lastError: action.message };
      return {
        ...state,
        lastError: action.message,
        conversations: {
          ...state.conversations,
          [conversationId]: { ...conversation, messages: [...conversation.messages, message] },
        },
      };
    }

    case "SET_ACTIVE_CONVERSATION": {
      const conversation = state.conversations[action.conversationId];
      if (!conversation) return state;
      return {
        ...state,
        activeConversationId: action.conversationId,
        conversations: { ...state.conversations, [action.conversationId]: { ...conversation, unreadCount: 0 } },
        sidebarOpen: false,
      };
    }

    case "SET_SIDEBAR_OPEN":
      return { ...state, sidebarOpen: action.open };
    case "SET_NICKNAME_MODAL":
      return { ...state, nicknameModalOpen: action.open };
    case "SET_NEW_GROUP_MODAL":
      return { ...state, newGroupModalOpen: action.open };
    case "MARK_PENDING_GROUP_CREATION":
      return { ...state, pendingGroupCreation: true };
    case "SET_ERROR":
      return { ...state, lastError: action.message };
    case "MARK_CONNECTED":
      return { ...state, hasConnectedOnce: true };

    case "RESET_CHAT":
      return {
        ...state,
        userId: null,
        nickname: "",
        presence: "online",
        users: {},
        conversations: { [PUBLIC_CONVERSATION_ID]: createPublicConversation() },
        activeConversationId: PUBLIC_CONVERSATION_ID,
        lastError: null,
      };

    default:
      return state;
  }
}

export function createInitialState(): ChatState {
  const settings = loadConnectionSettings();
  return {
    connectionStatus: "idle",
    settings,
    userId: null,
    nickname: "",
    presence: "online",
    users: {},
    conversations: { [PUBLIC_CONVERSATION_ID]: createPublicConversation() },
    activeConversationId: PUBLIC_CONVERSATION_ID,
    sidebarOpen: false,
    nicknameModalOpen: false,
    newGroupModalOpen: false,
    pendingGroupCreation: false,
    lastError: null,
    hasConnectedOnce: false,
  };
}
