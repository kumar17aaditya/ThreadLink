"use client";

import { useChat } from "@/context/ChatProvider";
import { Users, X } from "lucide-react";
import { useState } from "react";

export function NewGroupModalHost() {
  const { state, onlineUsers, createGroup, setNewGroupModalOpen } = useChat();
  return (
    <NewGroupModal
      open={state.newGroupModalOpen}
      candidates={onlineUsers}
      onClose={() => setNewGroupModalOpen(false)}
      onCreate={createGroup}
    />
  );
}

interface Candidate {
  id: string;
  nickname: string;
}

interface NewGroupModalProps {
  open: boolean;
  candidates: Candidate[];
  onClose: () => void;
  onCreate: (name: string, memberIds: string[]) => void;
}

function NewGroupModal({ open, ...rest }: NewGroupModalProps) {
  if (!open) return null;
  // Fresh key each time it opens, same reset-via-remount pattern as
  // NicknameModal -- avoids stale local state from a previous open
  // without needing an effect to "clean up" after the fact.
  return <NewGroupModalForm key={open ? "open" : "closed"} {...rest} />;
}

function NewGroupModalForm({ candidates, onClose, onCreate }: Omit<NewGroupModalProps, "open">) {
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const canCreate = name.trim().length > 0 && selected.size > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close new group dialog"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-group-title"
        className="relative w-full max-w-md rounded-2xl border border-white/8 bg-[#101012] p-6 shadow-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 id="new-group-title" className="text-lg font-semibold text-white">
              New group
            </h2>
            <p className="mt-1 text-sm text-zinc-500">Only online users can be added right now.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-500 transition hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!canCreate) return;
            onCreate(name.trim(), [...selected]);
          }}
        >
          <label htmlFor="group-name" className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-500">
            Group name
          </label>
          <input
            id="group-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Engineering"
            className="w-full rounded-xl border border-white/8 bg-[#0a0a0b] px-4 py-3 text-sm text-white outline-none focus:border-blue-500/40 focus:ring-2 focus:ring-blue-500/20 focus-visible:outline-none"
            autoFocus
          />

          <p className="mb-2 mt-5 text-xs font-medium uppercase tracking-wide text-zinc-500">
            Members ({selected.size} selected)
          </p>
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-white/8 bg-[#0a0a0b] p-2">
            {candidates.length === 0 ? (
              <p className="px-2 py-4 text-center text-sm text-zinc-600">No other users are online right now.</p>
            ) : (
              candidates.map((user) => (
                <label
                  key={user.id}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm text-zinc-200 transition hover:bg-white/5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-400/50"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(user.id)}
                    onChange={() => toggle(user.id)}
                    className="h-4 w-4 rounded border-white/20 bg-transparent accent-blue-600 focus-visible:outline-none"
                  />
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/5 text-xs font-semibold text-zinc-300">
                    {user.nickname.slice(0, 1).toUpperCase()}
                  </span>
                  {user.nickname}
                </label>
              ))
            )}
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-sm text-zinc-400 transition hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canCreate}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Users className="h-3.5 w-3.5" />
              Create group
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
