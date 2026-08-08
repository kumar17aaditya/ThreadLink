import type { ConnectionSettings } from "@/types/chat";

const STORAGE_KEY = "threadlink.connection";

const DEFAULT_GATEWAY = "ws://127.0.0.1:8081";

export function loadConnectionSettings(): ConnectionSettings {
  if (typeof window === "undefined") {
    return { gatewayUrl: DEFAULT_GATEWAY, nickname: "" };
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { gatewayUrl: DEFAULT_GATEWAY, nickname: "" };
    }
    const parsed = JSON.parse(raw) as Partial<ConnectionSettings>;
    return {
      gatewayUrl: parsed.gatewayUrl?.trim() || DEFAULT_GATEWAY,
      nickname: parsed.nickname?.trim() || "",
    };
  } catch {
    return { gatewayUrl: DEFAULT_GATEWAY, nickname: "" };
  }
}

export function saveConnectionSettings(settings: ConnectionSettings): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
