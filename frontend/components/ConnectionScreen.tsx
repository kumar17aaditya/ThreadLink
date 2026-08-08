"use client";

import { motion } from "framer-motion";
import { Loader2, Plug, WifiOff } from "lucide-react";
import { useState } from "react";
import { useChat } from "@/context/ChatProvider";
import { ConnectionStatusBadge } from "@/components/ConnectionStatusBadge";

export function ConnectionScreen() {
  const { state, connect } = useChat();
  const [gatewayUrl, setGatewayUrl] = useState(state.settings.gatewayUrl);
  const [nickname, setNickname] = useState(state.settings.nickname);

  const isBusy =
    state.connectionStatus === "connecting" ||
    state.connectionStatus === "reconnecting";

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    connect({ gatewayUrl, nickname });
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#070708] px-4">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(37,99,235,0.12),transparent_45%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(255,255,255,0.02),transparent_30%)]" />

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="relative w-full max-w-md rounded-2xl border border-white/8 bg-[#101012]/90 p-8 shadow-2xl shadow-black/40 backdrop-blur-xl"
      >
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-blue-500/20 bg-blue-500/10">
            <Plug className="h-5 w-5 text-blue-400" strokeWidth={1.75} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            ThreadLink
          </h1>
          <p className="mt-2 text-sm text-zinc-400">
            Connect to your gateway and join the conversation.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="gateway"
              className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-500"
            >
              Gateway address
            </label>
            <input
              id="gateway"
              type="text"
              value={gatewayUrl}
              onChange={(event) => setGatewayUrl(event.target.value)}
              placeholder="ws://127.0.0.1:8081"
              className="w-full rounded-xl border border-white/8 bg-[#0a0a0b] px-4 py-3 text-sm text-white outline-none transition focus:border-blue-500/40 focus:ring-2 focus:ring-blue-500/20"
              disabled={isBusy}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div>
            <label
              htmlFor="nickname"
              className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-500"
            >
              Nickname
            </label>
            <input
              id="nickname"
              type="text"
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              placeholder="Choose a display name"
              className="w-full rounded-xl border border-white/8 bg-[#0a0a0b] px-4 py-3 text-sm text-white outline-none transition focus:border-blue-500/40 focus:ring-2 focus:ring-blue-500/20"
              disabled={isBusy}
              autoComplete="username"
            />
          </div>

          {state.lastError && (
            <div
              role="alert"
              className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300"
            >
              {state.lastError}
            </div>
          )}

          <div className="flex items-center justify-between rounded-xl border border-white/6 bg-white/[0.02] px-4 py-3">
            <ConnectionStatusBadge status={state.connectionStatus} />
            {state.connectionStatus === "failed" && (
              <WifiOff className="h-4 w-4 text-red-400" aria-hidden />
            )}
          </div>

          <button
            type="submit"
            disabled={isBusy || !gatewayUrl.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isBusy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                {state.connectionStatus === "reconnecting"
                  ? "Reconnecting…"
                  : "Connecting…"}
              </>
            ) : (
              "Connect"
            )}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
