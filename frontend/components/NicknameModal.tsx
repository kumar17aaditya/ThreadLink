"use client";

import { useChat } from "@/context/ChatProvider";
import { X } from "lucide-react";
import { useState } from "react";

interface NicknameModalProps {
  open: boolean;
  currentNickname: string;
  onClose: () => void;
  onSubmit: (nickname: string) => void;
  error?: string | null;
}

export function NicknameModal({ open, ...rest }: NicknameModalProps) {
  if (!open) return null;
  // Keying on currentNickname (captured at the moment the modal opens)
  // remounts the form fresh each time it's opened, so its local `value`
  // state naturally starts at the current nickname with no effect needed
  // to "reset" it after the fact.
  return <NicknameModalForm key={rest.currentNickname} {...rest} />;
}

function NicknameModalForm({
  currentNickname,
  onClose,
  onSubmit,
  error,
}: Omit<NicknameModalProps, "open">) {
  const [value, setValue] = useState(currentNickname);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close nickname dialog"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="nickname-title"
        className="relative w-full max-w-md rounded-2xl border border-white/8 bg-[#101012] p-6 shadow-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 id="nickname-title" className="text-lg font-semibold text-white">
              Change nickname
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              This updates your display name for everyone in the chat.
            </p>
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
            onSubmit(value);
          }}
        >
          <label htmlFor="nickname-input" className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-500">
            Nickname
          </label>
          <input
            id="nickname-input"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="w-full rounded-xl border border-white/8 bg-[#0a0a0b] px-4 py-3 text-sm text-white outline-none focus:border-blue-500/40 focus:ring-2 focus:ring-blue-500/20 focus-visible:outline-none"
            autoFocus
          />

          {error && (
            <p role="alert" className="mt-3 text-sm text-red-400">
              {error}
            </p>
          )}

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
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function NicknameModalHost() {
  const { state, changeNickname, setNicknameModalOpen } = useChat();

  return (
    <NicknameModal
      open={state.nicknameModalOpen}
      currentNickname={state.nickname}
      onClose={() => setNicknameModalOpen(false)}
      onSubmit={changeNickname}
      error={state.lastError}
    />
  );
}
