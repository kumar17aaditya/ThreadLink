"use client";

import { ConnectionStatusBadge } from "@/components/ConnectionStatusBadge";
import { useChat } from "@/context/ChatProvider";
import { PUBLIC_CONVERSATION_ID } from "@/types/chat";
import {
  Hash,
  LogOut,
  MessageCircle,
  Plug,
  RefreshCw,
  Search,
  Settings2,
  UserRound,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";

interface SidebarProps {
  mobile?: boolean;
}

export function Sidebar({ mobile = false }: SidebarProps) {
  const {
    state,
    disconnect,
    connect,
    startPrivateConversation,
    openPublicConversation,
    setSidebarOpen,
    setNicknameModalOpen,
    requestUserList,
  } = useChat();

  const [query, setQuery] = useState("");
  const isConnected = state.connectionStatus === "connected";

  const filteredUsers = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return state.onlineUsers
      .filter((user) => user.nickname !== state.nickname)
      .filter((user) =>
        normalized ? user.nickname.toLowerCase().includes(normalized) : true,
      );
  }, [query, state.onlineUsers, state.nickname]);

  const containerClass = mobile
    ? "flex h-full w-[min(88vw,320px)] flex-col border-r border-white/8 bg-[#0a0a0b]"
    : "hidden h-full w-80 shrink-0 flex-col border-r border-white/8 bg-[#0a0a0b] lg:flex";

  return (
    <aside className={containerClass}>
      <div className="border-b border-white/8 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-blue-500/20 bg-blue-500/10">
                <Plug className="h-4 w-4 text-blue-400" />
              </div>
              <div>
                <h1 className="text-sm font-semibold text-white">ThreadLink</h1>
                <ConnectionStatusBadge status={state.connectionStatus} />
              </div>
            </div>
          </div>
          {mobile && (
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              className="rounded-lg p-1 text-zinc-500 hover:bg-white/5 hover:text-white lg:hidden"
              aria-label="Close sidebar"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="border-b border-white/8 p-4">
        <button
          type="button"
          onClick={openPublicConversation}
          className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
            state.activeConversationId === PUBLIC_CONVERSATION_ID
              ? "bg-blue-500/10 text-white"
              : "text-zinc-300 hover:bg-white/5"
          }`}
        >
          <Hash className="h-4 w-4 text-blue-400" />
          <span className="text-sm font-medium">Public Chat</span>
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Online · {filteredUsers.length}
          </h2>
          <button
            type="button"
            onClick={requestUserList}
            disabled={!isConnected}
            className="rounded-lg p-1 text-zinc-500 transition hover:bg-white/5 hover:text-white disabled:opacity-40"
            aria-label="Refresh user list"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="px-4 pb-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search users"
              className="w-full rounded-xl border border-white/8 bg-[#101012] py-2 pl-9 pr-3 text-sm text-white outline-none focus:border-blue-500/30 focus:ring-2 focus:ring-blue-500/10"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {filteredUsers.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-zinc-600">
              {isConnected ? "No other users online" : "Connect to see users"}
            </p>
          ) : (
            filteredUsers.map((user) => (
              <button
                key={user.id}
                type="button"
                onClick={() => startPrivateConversation(user.nickname)}
                className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                  state.activeConversationId === `private:${user.nickname.toLowerCase()}`
                    ? "bg-violet-500/10 text-white"
                    : "text-zinc-300 hover:bg-white/5"
                }`}
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-xs font-semibold text-zinc-300">
                  {user.nickname.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{user.nickname}</p>
                  <p className="text-xs text-zinc-500">Click to message</p>
                </div>
                <MessageCircle className="h-4 w-4 text-zinc-600" />
              </button>
            ))
          )}
        </div>
      </div>

      <div className="border-t border-white/8 p-4">
        <div className="mb-3 flex items-center gap-3 rounded-xl border border-white/8 bg-[#101012] px-3 py-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-500/15 text-sm font-semibold text-blue-300">
            {state.nickname ? state.nickname.slice(0, 1).toUpperCase() : "?"}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">
              {state.nickname || "Guest"}
            </p>
            <p className="truncate text-xs text-zinc-500">
              {state.settings.gatewayUrl}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setNicknameModalOpen(true)}
            disabled={!isConnected}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/8 px-3 py-2 text-xs font-medium text-zinc-300 transition hover:bg-white/5 disabled:opacity-40"
          >
            <UserRound className="h-3.5 w-3.5" />
            Nickname
          </button>
          <button
            type="button"
            onClick={() => setNicknameModalOpen(true)}
            disabled={!isConnected}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/8 px-3 py-2 text-xs font-medium text-zinc-300 transition hover:bg-white/5 disabled:opacity-40"
          >
            <Settings2 className="h-3.5 w-3.5" />
            Profile
          </button>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2">
          {!isConnected ? (
            <button
              type="button"
              onClick={() => connect()}
              className="col-span-2 inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-xs font-medium text-white transition hover:bg-blue-500"
            >
              <Plug className="h-3.5 w-3.5" />
              Reconnect
            </button>
          ) : (
            <button
              type="button"
              onClick={disconnect}
              className="col-span-2 inline-flex items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-300 transition hover:bg-red-500/15"
            >
              <LogOut className="h-3.5 w-3.5" />
              Disconnect
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
