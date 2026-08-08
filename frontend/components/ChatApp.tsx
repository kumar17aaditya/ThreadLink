"use client";

import { ChatLayout } from "@/components/ChatLayout";
import { ConnectionScreen } from "@/components/ConnectionScreen";
import { useChat } from "@/context/ChatProvider";

export function ChatApp() {
  const { state } = useChat();
  const showChat =
    state.connectionStatus === "connected" ||
    state.connectionStatus === "reconnecting" ||
    (state.hasConnectedOnce &&
      (state.connectionStatus === "disconnected" ||
        state.connectionStatus === "failed"));

  if (!showChat) {
    return <ConnectionScreen />;
  }

  return <ChatLayout />;
}
