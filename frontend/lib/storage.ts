/**
 * The gateway address is internal configuration, not something the
 * person using ThreadLink should ever see or type in -- see the
 * login screen, which only asks for a username and password. It's
 * sourced from a build-time env var so a real deployment can point
 * at its own gateway without exposing that detail in the UI.
 */
const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL?.trim() || "ws://127.0.0.1:8081";

export function getGatewayUrl(): string {
  return GATEWAY_URL;
}

const USERNAME_STORAGE_KEY = "threadlink.lastUsername";

/** Convenience only: pre-fills the username field on the login
 * screen. The password is never persisted anywhere on the client. */
export function loadLastUsername(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(USERNAME_STORAGE_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function saveLastUsername(username: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(USERNAME_STORAGE_KEY, username);
  } catch {
    /* localStorage unavailable (private browsing, quota, etc.) -- not fatal */
  }
}
