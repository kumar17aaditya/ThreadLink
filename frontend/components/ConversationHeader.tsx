"use client";

import { PresenceDot } from "@/components/PresenceDot";
import { useChat } from "@/context/ChatProvider";
import type { Conversation } from "@/types/chat";
import { Hash, Lock, Menu, UsersRound } from "lucide-react";

interface ConversationHeaderProps {
  conversation: Conversation;
  onOpenSidebar: () => void;
}

export function ConversationHeader({ conversation, onOpenSidebar }: ConversationHeaderProps) {
  const { state } = useChat();
  const isDirect = conversation.type === "direct";
  const isGroup = conversation.type === "group";

  const peer = isDirect && conversation.peerId ? state.users[conversation.peerId] : undefined;
  const onlineGroupMembers = isGroup
    ? (conversation.memberIds ?? []).filter((id) => id === state.userId || state.users[id]).length
    : 0;

  const iconWrapClass = isDirect
    ? "border-violet-500/20 bg-violet-500/10"
    : isGroup
      ? "border-cyan-500/20 bg-cyan-500/10"
      : "border-blue-500/20 bg-blue-500/10";

  const subtitle = isDirect
    ? peer
      ? `${peer.presence === "away" ? "Away" : "Online"} · Direct message`
      : "This user is offline"
    : isGroup
      ? `${conversation.memberIds?.length ?? 0} members · ${onlineGroupMembers} online`
      : "Visible to everyone online";

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

      <div className={`relative flex h-10 w-10 items-center justify-center rounded-xl border ${iconWrapClass}`}>
        {isDirect ? (
          <Lock className="h-4 w-4 text-violet-300" />
        ) : isGroup ? (
          <UsersRound className="h-4 w-4 text-cyan-300" />
        ) : (
          <Hash className="h-4 w-4 text-blue-300" />
        )}
        {isDirect && peer && <PresenceDot presence={peer.presence} className="absolute -bottom-0.5 -right-0.5" />}
      </div>

      <div className="min-w-0 flex-1">
        <h2 className="truncate text-sm font-semibold text-white">
          {isDirect ? conversation.title : isGroup ? conversation.title : "Public Chat"}
        </h2>
        <p className="truncate text-xs text-zinc-500">{subtitle}</p>
      </div>
    </header>
  );
}
