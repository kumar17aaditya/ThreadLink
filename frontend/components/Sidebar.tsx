"use client";

import { ConnectionStatusBadge } from "@/components/ConnectionStatusBadge";
import { PresenceDot } from "@/components/PresenceDot";
import { useChat } from "@/context/ChatProvider";
import { PUBLIC_CONVERSATION_ID } from "@/types/chat";
import {
  Hash,
  Lock,
  LogOut,
  Plug,
  Search,
  UserRound,
  UserRoundCog,
  Users,
  UsersRound,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";

interface SidebarProps {
  mobile?: boolean;
}

export function Sidebar({ mobile = false }: SidebarProps) {
  const {
    state,
    onlineUsers,
    logout,
    selectConversation,
    startDirectConversation,
    openPublicConversation,
    setSidebarOpen,
    setNicknameModalOpen,
    setNewGroupModalOpen,
    setPresence,
  } = useChat();

  const [query, setQuery] = useState("");
  const isConnected = state.connectionStatus === "connected";

  const directConversations = useMemo(
    () => Object.values(state.conversations).filter((c) => c.type === "direct"),
    [state.conversations],
  );
  const groupConversations = useMemo(
    () => Object.values(state.conversations).filter((c) => c.type === "group"),
    [state.conversations],
  );

  const filteredUsers = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return onlineUsers.filter((user) => (normalized ? user.nickname.toLowerCase().includes(normalized) : true));
  }, [query, onlineUsers]);

  const containerClass = mobile
    ? "flex h-full w-[min(88vw,320px)] flex-col border-r border-white/8 bg-[#0a0a0b]"
    : "hidden h-full w-80 shrink-0 flex-col border-r border-white/8 bg-[#0a0a0b] lg:flex";

  return (
    <aside className={containerClass}>
      <div className="border-b border-white/8 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-blue-500/20 bg-blue-500/10">
              <Plug className="h-4 w-4 text-blue-400" />
            </div>
            <div>
              <h1 className="text-sm font-semibold text-white">ThreadLink</h1>
              <ConnectionStatusBadge status={state.connectionStatus} />
            </div>
          </div>
          {mobile && (
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              className="rounded-lg p-1 text-zinc-500 transition hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 lg:hidden"
              aria-label="Close sidebar"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {/* Public */}
        <div className="pt-3">
          <button
            type="button"
            onClick={openPublicConversation}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 ${
              state.activeConversationId === PUBLIC_CONVERSATION_ID
                ? "bg-blue-500/10 text-white"
                : "text-zinc-300 hover:bg-white/5"
            }`}
          >
            <Hash className="h-4 w-4 shrink-0 text-blue-400" />
            <span className="text-sm font-medium">Public Chat</span>
          </button>
        </div>

        {/* Direct messages */}
        {directConversations.length > 0 && (
          <SidebarSection title="Direct Messages">
            {directConversations.map((c) => {
              const peer = c.peerId ? state.users[c.peerId] : undefined;
              // Same fallback order as ChatProvider's activeConversation
              // memo: live nickname if online, else the gateway-resolved
              // persisted title (set for restored conversations), else
              // a last-resort placeholder.
              const label = peer?.nickname || c.title || "Offline user";
              return (
                <SidebarRow
                  key={c.id}
                  active={state.activeConversationId === c.id}
                  icon={<Lock className="h-3.5 w-3.5 text-violet-300" />}
                  iconWrapClass="border-violet-500/20 bg-violet-500/10"
                  label={label}
                  badge={peer ? <PresenceDot presence={peer.presence} /> : undefined}
                  unread={c.unreadCount}
                  onClick={() => selectConversation(c.id)}
                />
              );
            })}
          </SidebarSection>
        )}

        {/* Groups */}
        {groupConversations.length > 0 && (
          <SidebarSection title="Groups">
            {groupConversations.map((c) => (
              <SidebarRow
                key={c.id}
                active={state.activeConversationId === c.id}
                icon={<UsersRound className="h-3.5 w-3.5 text-cyan-300" />}
                iconWrapClass="border-cyan-500/20 bg-cyan-500/10"
                label={c.title}
                unread={c.unreadCount}
                onClick={() => selectConversation(c.id)}
              />
            ))}
          </SidebarSection>
        )}

        {/* Online users */}
        <SidebarSection
          title={`Online · ${filteredUsers.length}`}
          action={
            <button
              type="button"
              onClick={() => setNewGroupModalOpen(true)}
              disabled={!isConnected || onlineUsers.length === 0}
              className="rounded-lg p-1 text-zinc-500 transition hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 disabled:opacity-40"
              aria-label="Start a new group"
              title="New group"
            >
              <Users className="h-3.5 w-3.5" />
            </button>
          }
        >
          <div className="px-1 pb-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search users"
                className="w-full rounded-xl border border-white/8 bg-[#101012] py-2 pl-9 pr-3 text-sm text-white outline-none focus:border-blue-500/30 focus:ring-2 focus:ring-blue-500/10 focus-visible:outline-none"
              />
            </div>
          </div>

          {filteredUsers.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-zinc-600">
              {isConnected ? "No other users online" : "Connect to see users"}
            </p>
          ) : (
            filteredUsers.map((user) => (
              <button
                key={user.id}
                type="button"
                onClick={() => startDirectConversation(user.id)}
                className="mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-zinc-300 transition hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50"
              >
                <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/5 text-xs font-semibold text-zinc-300">
                  {user.nickname.slice(0, 1).toUpperCase()}
                  <PresenceDot presence={user.presence} className="absolute -bottom-0.5 -right-0.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{user.nickname}</p>
                  <p className="truncate text-xs capitalize text-zinc-500">{user.presence}</p>
                </div>
              </button>
            ))
          )}
        </SidebarSection>
      </div>

      <div className="border-t border-white/8 p-4">
        <div className="mb-3 flex items-center gap-3 rounded-xl border border-white/8 bg-[#101012] px-3 py-2.5">
          <div className="relative flex h-9 w-9 items-center justify-center rounded-full bg-blue-500/15 text-sm font-semibold text-blue-300">
            {state.nickname ? state.nickname.slice(0, 1).toUpperCase() : "?"}
            {state.userId && <PresenceDot presence={state.presence} className="absolute -bottom-0.5 -right-0.5" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">{state.nickname || "Guest"}</p>
            <ConnectionStatusBadge status={state.connectionStatus} />
          </div>
          <button
            type="button"
            onClick={() => setPresence(state.presence === "away" ? "online" : "away")}
            disabled={!isConnected}
            className={`rounded-lg px-2 py-1 text-[10px] font-medium uppercase tracking-wide transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 disabled:opacity-40 ${
              state.presence === "away"
                ? "bg-amber-500/15 text-amber-300 hover:bg-amber-500/25"
                : "bg-white/5 text-zinc-400 hover:bg-white/10"
            }`}
            title="Toggle away status"
          >
            {state.presence === "away" ? "Away" : "Set away"}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setNicknameModalOpen(true)}
            disabled={!isConnected}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/8 px-3 py-2 text-xs font-medium text-zinc-300 transition hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 disabled:opacity-40"
          >
            <UserRound className="h-3.5 w-3.5" />
            Nickname
          </button>
          <button
            type="button"
            onClick={() => setNewGroupModalOpen(true)}
            disabled={!isConnected}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/8 px-3 py-2 text-xs font-medium text-zinc-300 transition hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 disabled:opacity-40"
          >
            <UserRoundCog className="h-3.5 w-3.5" />
            New group
          </button>
        </div>

        <div className="mt-2">
          <button
            type="button"
            onClick={logout}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-300 transition hover:bg-red-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/50"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
        </div>
      </div>
    </aside>
  );
}

function SidebarSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="pt-4">
      <div className="flex items-center justify-between px-3 pb-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

function SidebarRow({
  active,
  icon,
  iconWrapClass,
  label,
  badge,
  unread,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  iconWrapClass: string;
  label: string;
  badge?: React.ReactNode;
  unread: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 ${
        active ? "bg-white/8 text-white" : "text-zinc-300 hover:bg-white/5"
      }`}
    >
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${iconWrapClass}`}>
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{label}</span>
      {badge}
      {unread > 0 && (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-[10px] font-semibold text-white">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </button>
  );
}
