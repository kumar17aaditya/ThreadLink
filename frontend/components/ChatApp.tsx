"use client";

import { ChatLayout } from "@/components/ChatLayout";
import { LoginScreen } from "@/components/LoginScreen";
import { useChat } from "@/context/ChatProvider";

export function ChatApp() {
  const { state } = useChat();
  return state.userId ? <ChatLayout /> : <LoginScreen />;
}
