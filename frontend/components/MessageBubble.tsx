"use client";

import { format } from "@/lib/format";
import type { Message } from "@/types/chat";
import { motion } from "framer-motion";
import { AlertCircle, Lock, Megaphone } from "lucide-react";

interface MessageBubbleProps {
  message: Message;
  /** Shown next to the sender name for direct-message conversations,
   * to visually distinguish a DM bubble from a public/group one. */
  showPrivacyIcon?: boolean;
}

export function MessageBubble({ message, showPrivacyIcon = false }: MessageBubbleProps) {
  const isSystem = message.kind === "system";
  const isError = message.kind === "error";
  const isOwn = message.isOwn && !isSystem && !isError;

  if (isSystem || isError) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18 }}
        className="flex justify-center px-4 py-1"
      >
        <div
          className={`flex max-w-lg items-start gap-2 rounded-xl px-3 py-2 text-xs ${
            isError
              ? "border border-red-500/20 bg-red-500/10 text-red-300"
              : "border border-white/6 bg-white/[0.03] text-zinc-400"
          }`}
        >
          {isError ? (
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ) : (
            <Megaphone className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          <span>{message.content}</span>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`flex px-4 py-1 ${isOwn ? "justify-end" : "justify-start"}`}
    >
      <div
        className={`max-w-[min(72%,42rem)] rounded-2xl px-4 py-2.5 ${
          isOwn
            ? "rounded-br-md bg-blue-600 text-white"
            : "rounded-bl-md border border-white/8 bg-[#141417] text-zinc-100"
        }`}
      >
        {!isOwn && (
          <div className="mb-1 flex items-center gap-1.5">
            <span className="text-xs font-medium text-blue-300">
              {message.sender}
            </span>
            {showPrivacyIcon && (
              <Lock className="h-3 w-3 text-zinc-500" aria-label="Private" />
            )}
          </div>
        )}
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
          {message.content}
        </p>
        <time
          dateTime={message.timestamp.toISOString()}
          className={`mt-1 block text-[10px] ${
            isOwn ? "text-blue-100/70" : "text-zinc-500"
          }`}
        >
          {format.messageTime(message.timestamp)}
        </time>
      </div>
    </motion.div>
  );
}
