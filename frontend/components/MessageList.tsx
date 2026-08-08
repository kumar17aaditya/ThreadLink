"use client";

import { MessageBubble } from "@/components/MessageBubble";
import { useAutoScroll } from "@/hooks/useAutoScroll";
import type { Conversation } from "@/types/chat";
import { Hash, Lock, MessageSquareOff, WifiOff } from "lucide-react";

interface MessageListProps {
  conversation: Conversation;
  isConnected: boolean;
}

export function MessageList({ conversation, isConnected }: MessageListProps) {
  const { containerRef } = useAutoScroll<HTMLDivElement>(
    conversation.messages.length,
  );

  if (!isConnected) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <WifiOff className="h-8 w-8 text-zinc-600" strokeWidth={1.5} />
        <div>
          <p className="text-sm font-medium text-zinc-300">Disconnected</p>
          <p className="mt-1 text-sm text-zinc-500">
            Reconnect from the sidebar to continue messaging.
          </p>
        </div>
      </div>
    );
  }

  if (conversation.messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        {conversation.type === "private" ? (
          <Lock className="h-8 w-8 text-zinc-600" strokeWidth={1.5} />
        ) : (
          <Hash className="h-8 w-8 text-zinc-600" strokeWidth={1.5} />
        )}
        <div>
          <p className="text-sm font-medium text-zinc-300">
            {conversation.type === "private"
              ? `Message ${conversation.title}`
              : "Public chat is quiet"}
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            {conversation.type === "private"
              ? "Send a private message to start the conversation."
              : "Say hello to get things started."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto py-4"
      aria-live="polite"
      aria-relevant="additions"
    >
      {conversation.messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
    </div>
  );
}

export function DisconnectedBanner() {
  return (
    <div className="flex items-center gap-2 border-b border-amber-500/20 bg-amber-500/10 px-4 py-2 text-sm text-amber-200">
      <MessageSquareOff className="h-4 w-4 shrink-0" />
      <span>You are disconnected. Messages cannot be sent until reconnected.</span>
    </div>
  );
}
