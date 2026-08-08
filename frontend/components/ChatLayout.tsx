"use client";

import { ConversationHeader } from "@/components/ConversationHeader";
import { DisconnectedBanner, MessageList } from "@/components/MessageList";
import { MessageComposer } from "@/components/MessageComposer";
import { NicknameModalHost } from "@/components/NicknameModal";
import { Sidebar } from "@/components/Sidebar";
import { useChat } from "@/context/ChatProvider";

export function ChatLayout() {
  const { state, activeConversation, sendMessage, setSidebarOpen } = useChat();
  const isConnected = state.connectionStatus === "connected";

  const composerPlaceholder =
    activeConversation.type === "private"
      ? `Message ${activeConversation.title}…`
      : "Message public chat…";

  return (
    <div className="flex h-screen overflow-hidden bg-[#070708] text-white">
      <Sidebar />

      {state.sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar overlay"
          />
          <div className="relative z-10 h-full">
            <Sidebar mobile />
          </div>
        </div>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        <ConversationHeader
          conversation={activeConversation}
          onOpenSidebar={() => setSidebarOpen(true)}
        />

        {!isConnected && state.hasConnectedOnce && <DisconnectedBanner />}

        <MessageList conversation={activeConversation} isConnected={isConnected} />

        <MessageComposer
          disabled={!isConnected}
          placeholder={composerPlaceholder}
          onSend={sendMessage}
        />
      </main>

      <NicknameModalHost />
    </div>
  );
}
