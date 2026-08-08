"use client";

import { motion } from "framer-motion";
import { Loader2, Lock, Plug, UserRound } from "lucide-react";
import { useState } from "react";
import { useChat } from "@/context/ChatProvider";
import { loadLastUsername } from "@/lib/storage";

type Mode = "login" | "register";

export function LoginScreen() {
  const { state, login, register } = useChat();
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState(() => loadLastUsername());
  const [password, setPassword] = useState("");

  const isBusy = state.authenticating;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !password) return;
    if (mode === "login") login(username.trim(), password);
    else register(username.trim(), password);
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
          <h1 className="text-2xl font-semibold tracking-tight text-white">ThreadLink</h1>
          <p className="mt-2 text-sm text-zinc-400">
            {mode === "login" ? "Sign in to continue the conversation." : "Create an account to get started."}
          </p>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-1 rounded-xl border border-white/8 bg-[#0a0a0b] p-1">
          <button
            type="button"
            onClick={() => setMode("login")}
            aria-label="Switch to sign in"
            className={`rounded-lg py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 ${
              mode === "login" ? "bg-blue-600 text-white" : "text-zinc-400 hover:text-white"
            }`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => setMode("register")}
            aria-label="Switch to create account"
            className={`rounded-lg py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 ${
              mode === "register" ? "bg-blue-600 text-white" : "text-zinc-400 hover:text-white"
            }`}
          >
            Create account
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="username" className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-500">
              Username
            </label>
            <div className="relative">
              <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
              <input
                id="username"
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="Choose a username"
                className="w-full rounded-xl border border-white/8 bg-[#0a0a0b] py-3 pl-10 pr-4 text-sm text-white outline-none transition focus:border-blue-500/40 focus:ring-2 focus:ring-blue-500/20"
                disabled={isBusy}
                autoComplete="username"
                autoFocus
              />
            </div>
          </div>

          <div>
            <label htmlFor="password" className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-500">
              Password
            </label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
              <input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={mode === "register" ? "At least 8 characters" : "Your password"}
                className="w-full rounded-xl border border-white/8 bg-[#0a0a0b] py-3 pl-10 pr-4 text-sm text-white outline-none transition focus:border-blue-500/40 focus:ring-2 focus:ring-blue-500/20"
                disabled={isBusy}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                minLength={mode === "register" ? 8 : undefined}
              />
            </div>
          </div>

          {state.authError && (
            <div role="alert" className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {state.authError}
            </div>
          )}

          <button
            type="submit"
            disabled={isBusy || !username.trim() || !password}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isBusy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                {mode === "login" ? "Signing in…" : "Creating account…"}
              </>
            ) : mode === "login" ? (
              "Sign in"
            ) : (
              "Create account"
            )}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
