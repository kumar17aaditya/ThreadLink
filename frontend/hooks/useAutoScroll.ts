"use client";

import { useCallback, useEffect, useRef } from "react";

interface UseAutoScrollOptions {
  threshold?: number;
}

export function useAutoScroll<T extends HTMLElement>(
  dependency: unknown,
  options: UseAutoScrollOptions = {},
) {
  const containerRef = useRef<T | null>(null);
  const pinnedToBottomRef = useRef(true);
  const threshold = options.threshold ?? 96;

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const container = containerRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior });
    pinnedToBottomRef.current = true;
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      pinnedToBottomRef.current = distanceFromBottom <= threshold;
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [threshold]);

  useEffect(() => {
    if (pinnedToBottomRef.current) {
      scrollToBottom("smooth");
    }
  }, [dependency, scrollToBottom]);

  return { containerRef, scrollToBottom, isPinnedToBottom: pinnedToBottomRef };
}
