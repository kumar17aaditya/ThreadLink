"use client";

import { Send } from "lucide-react";
import { useState, type KeyboardEvent } from "react";

interface MessageComposerProps {
  disabled: boolean;
  placeholder: string;
  onSend: (content: string) => void;
}

export function MessageComposer({
  disabled,
  placeholder,
  onSend,
}: MessageComposerProps) {
  const [value, setValue] = useState("");

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="border-t border-white/8 bg-[#0c0c0e]/80 p-4 backdrop-blur-sm">
      <div className="flex items-end gap-3 rounded-2xl border border-white/8 bg-[#101012] p-2 focus-within:border-blue-500/30 focus-within:ring-2 focus-within:ring-blue-500/10">
        <textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-600 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Message input"
        />
        <button
          type="button"
          onClick={submit}
          disabled={disabled || !value.trim()}
          className="mb-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white transition hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Send message"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-2 px-1 text-[11px] text-zinc-600">
        Enter to send · Shift+Enter for newline
      </p>
    </div>
  );
}
