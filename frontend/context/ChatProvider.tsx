"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import { ThreadLinkClient } from "@/lib/websocket-client";
import { createId } from "@/lib/id";
import { loadConnectionSettings, saveConnectionSettings } from "@/lib/storage";
import type {
  ConnectionSettings,
  Conversation,
  Message,
  User,
} from "@/types/chat";
import {
  PUBLIC_CONVERSATION_ID,
  privateConversationId,
} from "@/types/chat";
import type { ConnectionStatus, ParsedServerEvent } from "@/types/protocol";

interface ChatState {
  connectionStatus: ConnectionStatus;
  settings: ConnectionSettings;
  nickname: string;
  onlineUsers: User[];
  conversations: Record<string, Conversation>;
  activeConversationId: string;
  sidebarOpen: boolean;
  nicknameModalOpen: boolean;
  lastError: string | null;
  hasConnectedOnce: boolean;
}

type ChatAction =
  | { type: "SET_STATUS"; status: ConnectionStatus }
  | { type: "SET_SETTINGS"; settings: ConnectionSettings }
  | { type: "SET_NICKNAME"; nickname: string }
  | { type: "SET_USERS"; users: string[] }
  | { type: "ADD_MESSAGE"; conversationId: string; message: Message }
  | { type: "SET_ACTIVE_CONVERSATION"; conversationId: string }
  | { type: "SET_SIDEBAR_OPEN"; open: boolean }
  | { type: "SET_NICKNAME_MODAL"; open: boolean }
  | { type: "SET_ERROR"; message: string | null }
  | { type: "RESET_CHAT" }
  | { type: "MARK_CONNECTED" };

function createPublicConversation(): Conversation {
  return {
    id: PUBLIC_CONVERSATION_ID,
    type: "public",
    title: "Public Chat",
    messages: [],
    unreadCount: 0,
  };
}

function createPrivateConversation(participantNickname: string): Conversation {
  return {
    id: privateConversationId(participantNickname),
    type: "private",
    title: participantNickname,
    participantNickname,
    messages: [],
    unreadCount: 0,
  };
}

function ensureConversation(
  conversations: Record<string, Conversation>,
  conversationId: string,
  factory: () => Conversation,
): Record<string, Conversation> {
  if (conversations[conversationId]) return conversations;
  return { ...conversations, [conversationId]: factory() };
}

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "SET_STATUS":
      return { ...state, connectionStatus: action.status };
    case "SET_SETTINGS":
      return { ...state, settings: action.settings };
    case "SET_NICKNAME":
      return { ...state, nickname: action.nickname };
    case "SET_USERS": {
      const onlineUsers = action.users.map((nickname) => ({
        id: nickname.toLowerCase(),
        nickname,
        isOnline: true,
      }));
      return { ...state, onlineUsers };
    }
    case "ADD_MESSAGE": {
      const existing =
        state.conversations[action.conversationId] ??
        (action.conversationId.startsWith("private:")
          ? createPrivateConversation(
              action.conversationId.slice("private:".length),
            )
          : null);

      if (!existing) return state;

      const isActive = state.activeConversationId === action.conversationId;
      const updatedConversation: Conversation = {
        ...existing,
        messages: [...existing.messages, action.message],
        unreadCount: isActive ? 0 : existing.unreadCount + 1,
      };

      return {
        ...state,
        conversations: {
          ...state.conversations,
          [action.conversationId]: updatedConversation,
        },
      };
    }
    case "SET_ACTIVE_CONVERSATION": {
      const conversation = state.conversations[action.conversationId];
      if (!conversation) return state;
      return {
        ...state,
        activeConversationId: action.conversationId,
        conversations: {
          ...state.conversations,
          [action.conversationId]: { ...conversation, unreadCount: 0 },
        },
        sidebarOpen: false,
      };
    }
    case "SET_SIDEBAR_OPEN":
      return { ...state, sidebarOpen: action.open };
    case "SET_NICKNAME_MODAL":
      return { ...state, nicknameModalOpen: action.open };
    case "SET_ERROR":
      return { ...state, lastError: action.message };
    case "MARK_CONNECTED":
      return { ...state, hasConnectedOnce: true };
    case "RESET_CHAT":
      return {
        ...state,
        nickname: "",
        onlineUsers: [],
        conversations: { [PUBLIC_CONVERSATION_ID]: createPublicConversation() },
        activeConversationId: PUBLIC_CONVERSATION_ID,
        lastError: null,
      };
    default:
      return state;
  }
}

function createInitialState(): ChatState {
  const settings = loadConnectionSettings();
  return {
    connectionStatus: "idle",
    settings,
    nickname: "",
    onlineUsers: [],
    conversations: { [PUBLIC_CONVERSATION_ID]: createPublicConversation() },
    activeConversationId: PUBLIC_CONVERSATION_ID,
    sidebarOpen: false,
    nicknameModalOpen: false,
    lastError: null,
    hasConnectedOnce: false,
  };
}

interface ChatContextValue {
  state: ChatState;
  activeConversation: Conversation;
  connect: (settings?: Partial<ConnectionSettings>) => void;
  disconnect: () => void;
  sendMessage: (content: string) => void;
  changeNickname: (nickname: string) => void;
  requestUserList: () => void;
  selectConversation: (conversationId: string) => void;
  startPrivateConversation: (nickname: string) => void;
  openPublicConversation: () => void;
  setSidebarOpen: (open: boolean) => void;
  setNicknameModalOpen: (open: boolean) => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(chatReducer, undefined, createInitialState);
  const clientRef = useRef<ThreadLinkClient | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const appendMessage = useCallback(
    (conversationId: string, message: Omit<Message, "id">) => {
      dispatch({
        type: "ADD_MESSAGE",
        conversationId,
        message: { ...message, id: createId("msg") },
      });
    },
    [],
  );

  const handleServerEvents = useCallback(
    (events: ParsedServerEvent[]) => {
      for (const event of events) {
        const current = stateRef.current;

        switch (event.kind) {
          case "connected": {
            dispatch({ type: "SET_NICKNAME", nickname: event.nickname });
            dispatch({ type: "MARK_CONNECTED" });
            if (event.message) {
              appendMessage(PUBLIC_CONVERSATION_ID, {
                kind: "system",
                content: event.message,
                timestamp: new Date(),
                isOwn: false,
              });
            }
            clientRef.current?.requestUserList();
            break;
          }
          case "chat": {
            appendMessage(PUBLIC_CONVERSATION_ID, {
              kind: "chat",
              sender: event.from,
              content: event.content,
              timestamp: event.timestamp ?? new Date(),
              isOwn: event.from === current.nickname,
            });
            break;
          }
          case "private": {
            const peer =
              event.from === current.nickname
                ? event.to ?? "Unknown"
                : event.from;
            const conversationId = privateConversationId(peer);
            dispatch({
              type: "ADD_MESSAGE",
              conversationId,
              message: {
                id: createId("msg"),
                kind: "private",
                sender: event.from,
                content: event.content,
                timestamp: event.timestamp ?? new Date(),
                isOwn: event.from === current.nickname,
              },
            });
            break;
          }
          case "system": {
            appendMessage(PUBLIC_CONVERSATION_ID, {
              kind: "system",
              content: event.content,
              timestamp: event.timestamp ?? new Date(),
              isOwn: false,
            });
            break;
          }
          case "error": {
            const activeId = current.activeConversationId;
            appendMessage(activeId, {
              kind: "error",
              content: event.content,
              timestamp: event.timestamp ?? new Date(),
              isOwn: false,
            });
            dispatch({ type: "SET_ERROR", message: event.content });
            break;
          }
          case "users":
            dispatch({ type: "SET_USERS", users: event.users });
            break;
          case "nick": {
            if (event.newNickname === current.nickname || event.oldNickname === current.nickname) {
              dispatch({ type: "SET_NICKNAME", nickname: event.newNickname });
            }
            appendMessage(PUBLIC_CONVERSATION_ID, {
              kind: "system",
              content: `${event.oldNickname} is now known as ${event.newNickname}.`,
              timestamp: event.timestamp ?? new Date(),
              isOwn: false,
            });
            clientRef.current?.requestUserList();
            break;
          }
        }
      }
    },
    [appendMessage],
  );

  const connect = useCallback(
    (overrides?: Partial<ConnectionSettings>) => {
      const nextSettings: ConnectionSettings = {
        gatewayUrl: overrides?.gatewayUrl?.trim() || state.settings.gatewayUrl,
        nickname: overrides?.nickname?.trim() ?? state.settings.nickname,
      };

      saveConnectionSettings(nextSettings);
      dispatch({ type: "SET_SETTINGS", settings: nextSettings });
      dispatch({ type: "RESET_CHAT" });
      dispatch({ type: "SET_ERROR", message: null });

      clientRef.current?.disconnect();
      const client = new ThreadLinkClient({
        url: nextSettings.gatewayUrl,
        onStatusChange: (status) => {
          dispatch({ type: "SET_STATUS", status });
          if (status === "connected" && nextSettings.nickname) {
            client.sendNick(nextSettings.nickname);
          }
        },
        onEvent: handleServerEvents,
        onError: (message) => dispatch({ type: "SET_ERROR", message }),
        reconnect: true,
      });

      clientRef.current = client;
      client.connect();
    },
    [handleServerEvents, state.settings],
  );

  const disconnect = useCallback(() => {
    clientRef.current?.disconnect();
    clientRef.current = null;
    dispatch({ type: "SET_STATUS", status: "disconnected" });
    dispatch({ type: "RESET_CHAT" });
  }, []);

  const sendMessage = useCallback((content: string) => {
    const trimmed = content.trim();
    if (!trimmed) return;

    const current = stateRef.current;
    const client = clientRef.current;
    if (!client?.isConnected()) {
      dispatch({ type: "SET_ERROR", message: "Not connected to gateway" });
      return;
    }

    const active = current.conversations[current.activeConversationId];
    if (!active) return;

    if (active.type === "public") {
      client.sendChat(trimmed);
      return;
    }

    const recipient = active.participantNickname;
    if (!recipient) return;
    client.sendPrivate(recipient, trimmed);
  }, []);

  const changeNickname = useCallback((nickname: string) => {
    const trimmed = nickname.trim();
    if (!trimmed) {
      dispatch({ type: "SET_ERROR", message: "Nickname cannot be empty" });
      return;
    }

    const sent = clientRef.current?.sendNick(trimmed);
    if (sent) {
      dispatch({ type: "SET_NICKNAME", nickname: trimmed });
      dispatch({
        type: "SET_SETTINGS",
        settings: {
          ...stateRef.current.settings,
          nickname: trimmed,
        },
      });
      saveConnectionSettings({
        ...stateRef.current.settings,
        nickname: trimmed,
      });
      dispatch({ type: "SET_NICKNAME_MODAL", open: false });
    }
  }, []);

  const requestUserList = useCallback(() => {
    clientRef.current?.requestUserList();
  }, []);

  const selectConversation = useCallback((conversationId: string) => {
    dispatch({ type: "SET_ACTIVE_CONVERSATION", conversationId });
  }, []);

  const startPrivateConversation = useCallback((nickname: string) => {
    if (nickname === stateRef.current.nickname) return;

    const conversationId = privateConversationId(nickname);
    const current = stateRef.current;

    if (!current.conversations[conversationId]) {
      dispatch({
        type: "ADD_MESSAGE",
        conversationId,
        message: {
          id: createId("msg"),
          kind: "system",
          content: `Private conversation with ${nickname}`,
          timestamp: new Date(),
          isOwn: false,
        },
      });
    }

    dispatch({ type: "SET_ACTIVE_CONVERSATION", conversationId });
  }, []);

  const openPublicConversation = useCallback(() => {
    dispatch({ type: "SET_ACTIVE_CONVERSATION", conversationId: PUBLIC_CONVERSATION_ID });
  }, []);

  const activeConversation =
    state.conversations[state.activeConversationId] ??
    state.conversations[PUBLIC_CONVERSATION_ID];

  const value = useMemo<ChatContextValue>(
    () => ({
      state,
      activeConversation,
      connect,
      disconnect,
      sendMessage,
      changeNickname,
      requestUserList,
      selectConversation,
      startPrivateConversation,
      openPublicConversation,
      setSidebarOpen: (open) => dispatch({ type: "SET_SIDEBAR_OPEN", open }),
      setNicknameModalOpen: (open) =>
        dispatch({ type: "SET_NICKNAME_MODAL", open }),
    }),
    [
      state,
      activeConversation,
      connect,
      disconnect,
      sendMessage,
      changeNickname,
      requestUserList,
      selectConversation,
      startPrivateConversation,
      openPublicConversation,
    ],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChat must be used within ChatProvider");
  }
  return context;
}

export { createPrivateConversation, ensureConversation, privateConversationId };
