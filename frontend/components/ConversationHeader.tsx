"use client";

import type { Conversation } from "@/types/chat";
import { Hash, Lock, Menu } from "lucide-react";

interface ConversationHeaderProps {
  conversation: Conversation;
  onOpenSidebar: () => void;
}

export function ConversationHeader({
  conversation,
  onOpenSidebar,
}: ConversationHeaderProps) {
  const isPrivate = conversation.type === "private";

  return (
    <header className="flex items-center gap-3 border-b border-white/8 bg-[#0c0c0e]/70 px-4 py-3 backdrop-blur-sm">
      <button
        type="button"
        onClick={onOpenSidebar}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/8 text-zinc-400 transition hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/40 lg:hidden"
        aria-label="Open sidebar"
      >
        <Menu className="h-4 w-4" />
      </button>

      <div
        className={`flex h-10 w-10 items-center justify-center rounded-xl border ${
          isPrivate
            ? "border-violet-500/20 bg-violet-500/10"
            : "border-blue-500/20 bg-blue-500/10"
        }`}
      >
        {isPrivate ? (
          <Lock className="h-4 w-4 text-violet-300" />
        ) : (
          <Hash className="h-4 w-4 text-blue-300" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <h2 className="truncate text-sm font-semibold text-white">
          {isPrivate ? conversation.title : "Public Chat"}
        </h2>
        <p className="truncate text-xs text-zinc-500">
          {isPrivate
            ? "End-to-end private conversation"
            : "Visible to everyone online"}
        </p>
      </div>
    </header>
  );
}
