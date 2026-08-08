"use client";

/**
 * Layering (per the architecture this project intentionally keeps
 * separated):
 *
 *   WebSocket transport      (lib/websocket-client.ts)
 *         v
 *   Protocol/message parsing (types/protocol.ts)
 *         v
 *   Connection state          -----+
 *   User state                     |  all owned by this reducer
 *   Conversation state              |
 *   Message state              -----+
 *         v
 *   UI state (components read via useChat())
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import { ThreadLinkClient } from "@/lib/websocket-client";
import { saveConnectionSettings } from "@/lib/storage";
import { chatReducer, createInitialState, type ChatState } from "@/context/chatState";
import { Conversation, ConnectionSettings, User, PUBLIC_CONVERSATION_ID, directConversationId } from "@/types/chat";
import type { ServerMessage } from "@/types/protocol";

interface ChatContextValue {
  state: ChatState;
  activeConversation: Conversation;
  onlineUsers: User[];
  connect: (settings?: Partial<ConnectionSettings>) => void;
  disconnect: () => void;
  sendMessage: (content: string) => void;
  changeNickname: (nickname: string) => void;
  setPresence: (presence: "online" | "away") => void;
  selectConversation: (conversationId: string) => void;
  startDirectConversation: (peerId: string) => void;
  createGroup: (name: string, memberIds: string[]) => void;
  openPublicConversation: () => void;
  setSidebarOpen: (open: boolean) => void;
  setNicknameModalOpen: (open: boolean) => void;
  setNewGroupModalOpen: (open: boolean) => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(chatReducer, undefined, createInitialState);
  const clientRef = useRef<ThreadLinkClient | null>(null);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  const handleServerEvent = useCallback((event: ServerMessage) => {
    switch (event.type) {
      case "ready":
        dispatch({ type: "READY", userId: event.userId, username: event.username, users: event.users, conversations: event.conversations });
        dispatch({ type: "MARK_CONNECTED" });
        return;
      case "userUpdate":
        dispatch({ type: "USER_UPDATE", user: event.user });
        return;
      case "userOffline":
        dispatch({ type: "USER_OFFLINE", userId: event.userId });
        return;
      case "conversationCreated":
        dispatch({ type: "CONVERSATION_CREATED", conversation: event.conversation });
        return;
      case "message":
        dispatch({ type: "MESSAGE_RECEIVED", message: event.message });
        return;
      case "error":
        dispatch({ type: "ERROR_MESSAGE", code: event.code, message: event.message, conversationId: event.conversationId });
        return;
    }
  }, []);

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
            client.setNickname(nextSettings.nickname);
          }
        },
        onEvent: handleServerEvent,
        onError: (message) => dispatch({ type: "SET_ERROR", message }),
        reconnect: true,
      });

      clientRef.current = client;
      client.connect();
    },
    [handleServerEvent, state.settings],
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
      client.sendMessage({ kind: "public" }, trimmed);
    } else if (active.type === "direct" && active.peerId) {
      client.sendMessage({ kind: "direct", peerId: active.peerId }, trimmed);
    } else if (active.type === "group") {
      client.sendMessage({ kind: "group", groupId: active.id }, trimmed);
    }
  }, []);

  const changeNickname = useCallback((nickname: string) => {
    const trimmed = nickname.trim();
    if (!trimmed) {
      dispatch({ type: "SET_ERROR", message: "Nickname cannot be empty" });
      return;
    }
    const sent = clientRef.current?.setNickname(trimmed);
    if (sent) {
      dispatch({ type: "SET_SETTINGS", settings: { ...stateRef.current.settings, nickname: trimmed } });
      saveConnectionSettings({ ...stateRef.current.settings, nickname: trimmed });
      dispatch({ type: "SET_NICKNAME_MODAL", open: false });
    }
  }, []);

  const setPresence = useCallback((presence: "online" | "away") => {
    clientRef.current?.setPresence(presence);
  }, []);

  const selectConversation = useCallback((conversationId: string) => {
    dispatch({ type: "SET_ACTIVE_CONVERSATION", conversationId });
  }, []);

  const startDirectConversation = useCallback((peerId: string) => {
    const current = stateRef.current;
    if (!current.userId || peerId === current.userId) return;
    const conversationId = directConversationId(current.userId, peerId);

    if (!current.conversations[conversationId]) {
      dispatch({
        type: "CONVERSATION_CREATED",
        conversation: { id: conversationId, kind: "direct", title: "", memberIds: [current.userId, peerId] },
      });
    }
    dispatch({ type: "SET_ACTIVE_CONVERSATION", conversationId });
  }, []);

  const createGroup = useCallback((name: string, memberIds: string[]) => {
    const trimmed = name.trim();
    if (!trimmed || memberIds.length === 0) return;
    dispatch({ type: "MARK_PENDING_GROUP_CREATION" });
    clientRef.current?.createGroup(trimmed, memberIds);
  }, []);

  const openPublicConversation = useCallback(() => {
    dispatch({ type: "SET_ACTIVE_CONVERSATION", conversationId: PUBLIC_CONVERSATION_ID });
  }, []);

  const activeConversationRaw = state.conversations[state.activeConversationId] ?? state.conversations[PUBLIC_CONVERSATION_ID];
  const activeConversation: Conversation = useMemo(() => {
    if (activeConversationRaw.type === "direct" && activeConversationRaw.peerId) {
      const peer = state.users[activeConversationRaw.peerId];
      return { ...activeConversationRaw, title: peer?.nickname ?? "Offline user" };
    }
    return activeConversationRaw;
  }, [activeConversationRaw, state.users]);

  const onlineUsers = useMemo(
    () => Object.values(state.users).filter((u) => u.id !== state.userId),
    [state.users, state.userId],
  );

  const value = useMemo<ChatContextValue>(
    () => ({
      state,
      activeConversation,
      onlineUsers,
      connect,
      disconnect,
      sendMessage,
      changeNickname,
      setPresence,
      selectConversation,
      startDirectConversation,
      createGroup,
      openPublicConversation,
      setSidebarOpen: (open) => dispatch({ type: "SET_SIDEBAR_OPEN", open }),
      setNicknameModalOpen: (open) => dispatch({ type: "SET_NICKNAME_MODAL", open }),
      setNewGroupModalOpen: (open) => dispatch({ type: "SET_NEW_GROUP_MODAL", open }),
    }),
    [
      state,
      activeConversation,
      onlineUsers,
      connect,
      disconnect,
      sendMessage,
      changeNickname,
      setPresence,
      selectConversation,
      startDirectConversation,
      createGroup,
      openPublicConversation,
    ],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const context = useContext(ChatContext);
  if (!context) throw new Error("useChat must be used within ChatProvider");
  return context;
}
