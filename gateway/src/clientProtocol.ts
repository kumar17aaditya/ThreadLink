/**
 * The browser <-> gateway JSON protocol. This is the actual contract
 * documented in docs/GATEWAY_PROTOCOL.md — keep the two in sync.
 *
 * Design notes:
 *  - `userId` is the persistent account id (see users.ts), stable
 *    across logins/reconnects/gateway restarts -- not a per-session
 *    identity. A client must register or log in before doing
 *    anything else; the gateway enforces this (see gatewayServer.ts).
 *  - Presence is "online" | "away" | "offline". "online"/"offline"
 *    are grounded in real connection state (logged in with a live
 *    backend TCP connection / session gone); "away" is an explicit,
 *    real-time client signal broadcast to every other session — not
 *    a frontend-only decoration. Presence is runtime-only and is not
 *    persisted; every account starts a fresh session as "offline"
 *    until it logs in again.
 */

// ---- Client -> Gateway ----

export type MessageTarget =
  | { kind: "public" }
  | { kind: "direct"; peerId: string }
  | { kind: "group"; groupId: string };

export type ClientMessage =
  | { type: "register"; username: string; password: string }
  | { type: "login"; username: string; password: string }
  | { type: "logout" }
  | { type: "setNickname"; nickname: string }
  | { type: "sendMessage"; target: MessageTarget; text: string }
  | { type: "createGroup"; name: string; memberIds: string[] }
  | { type: "setPresence"; presence: "online" | "away" }
  | { type: "requestState" };

const MAX_NICKNAME_LEN = 24;
const MAX_TEXT_LEN = 4000;
const MAX_GROUP_NAME_LEN = 48;
const MAX_GROUP_MEMBERS = 64;
const MAX_USERNAME_LEN = 24;
const MAX_PASSWORD_LEN = 256;

export type ValidationResult =
  | { ok: true; message: ClientMessage }
  | { ok: false; error: string };

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/** Validates and narrows an arbitrary parsed-JSON value into a ClientMessage. */
export function validateClientMessage(raw: unknown): ValidationResult {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "message must be a JSON object" };
  }
  const obj = raw as Record<string, unknown>;
  const type = obj["type"];

  switch (type) {
    case "register": {
      const username = obj["username"];
      const password = obj["password"];
      if (!isNonEmptyString(username) || username.length > MAX_USERNAME_LEN) {
        return { ok: false, error: `username must be 1-${MAX_USERNAME_LEN} characters` };
      }
      if (!isNonEmptyString(password) || password.length > MAX_PASSWORD_LEN) {
        return { ok: false, error: "password is required" };
      }
      return { ok: true, message: { type: "register", username, password } };
    }
    case "login": {
      const username = obj["username"];
      const password = obj["password"];
      if (!isNonEmptyString(username) || username.length > MAX_USERNAME_LEN) {
        return { ok: false, error: `username must be 1-${MAX_USERNAME_LEN} characters` };
      }
      if (!isNonEmptyString(password) || password.length > MAX_PASSWORD_LEN) {
        return { ok: false, error: "password is required" };
      }
      return { ok: true, message: { type: "login", username, password } };
    }
    case "logout":
      return { ok: true, message: { type: "logout" } };
    case "setNickname": {
      if (!isNonEmptyString(obj["nickname"]) || obj["nickname"].length > MAX_NICKNAME_LEN) {
        return { ok: false, error: `nickname must be 1-${MAX_NICKNAME_LEN} characters` };
      }
      return { ok: true, message: { type: "setNickname", nickname: obj["nickname"] } };
    }
    case "sendMessage": {
      const text = obj["text"];
      if (!isNonEmptyString(text) || text.length > MAX_TEXT_LEN) {
        return { ok: false, error: `text must be 1-${MAX_TEXT_LEN} characters` };
      }
      const target = validateTarget(obj["target"]);
      if (!target.ok) return target;
      return { ok: true, message: { type: "sendMessage", target: target.value, text } };
    }
    case "createGroup": {
      const name = obj["name"];
      if (!isNonEmptyString(name) || name.length > MAX_GROUP_NAME_LEN) {
        return { ok: false, error: `group name must be 1-${MAX_GROUP_NAME_LEN} characters` };
      }
      const memberIds = obj["memberIds"];
      if (
        !Array.isArray(memberIds) ||
        memberIds.length === 0 ||
        memberIds.length > MAX_GROUP_MEMBERS ||
        !memberIds.every((m) => typeof m === "string" && m.length > 0)
      ) {
        return { ok: false, error: `memberIds must be a non-empty array of up to ${MAX_GROUP_MEMBERS} user ids` };
      }
      return { ok: true, message: { type: "createGroup", name, memberIds: memberIds as string[] } };
    }
    case "setPresence": {
      const presence = obj["presence"];
      if (presence !== "online" && presence !== "away") {
        return { ok: false, error: "presence must be 'online' or 'away'" };
      }
      return { ok: true, message: { type: "setPresence", presence } };
    }
    case "requestState":
      return { ok: true, message: { type: "requestState" } };
    default:
      return { ok: false, error: `unknown message type '${String(type)}'` };
  }
}

function validateTarget(raw: unknown): { ok: true; value: MessageTarget } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "target must be an object" };
  }
  const obj = raw as Record<string, unknown>;
  switch (obj["kind"]) {
    case "public":
      return { ok: true, value: { kind: "public" } };
    case "direct":
      if (!isNonEmptyString(obj["peerId"])) return { ok: false, error: "direct target requires peerId" };
      return { ok: true, value: { kind: "direct", peerId: obj["peerId"] } };
    case "group":
      if (!isNonEmptyString(obj["groupId"])) return { ok: false, error: "group target requires groupId" };
      return { ok: true, value: { kind: "group", groupId: obj["groupId"] } };
    default:
      return { ok: false, error: "target.kind must be 'public', 'direct', or 'group'" };
  }
}

// ---- Gateway -> Client ----

export type Presence = "online" | "away" | "offline";

export interface UserSummary {
  id: string;
  username: string;
  presence: Presence;
}

export type ConversationKind = "public" | "direct" | "group";

export interface ConversationSummary {
  id: string;
  kind: ConversationKind;
  title: string;
  memberIds: string[];
}

export interface MessageSummary {
  id: string;
  conversationId: string;
  kind: "chat" | "system";
  senderId: string | null;
  senderUsername: string | null;
  text: string;
  timestamp: string;
}

export type ServerMessage =
  | {
      type: "ready";
      userId: string;
      username: string;
      users: UserSummary[];
      conversations: ConversationSummary[];
      /** Full persisted message history across every conversation the
       * user is a member of (plus public), oldest first -- lets the
       * client fully restore its conversation views after login
       * without a separate round trip. */
      messages: MessageSummary[];
    }
  | { type: "loggedOut" }
  | { type: "userUpdate"; user: UserSummary }
  | { type: "userOffline"; userId: string }
  | { type: "conversationCreated"; conversation: ConversationSummary }
  | { type: "message"; message: MessageSummary }
  | { type: "error"; code: string; message: string; conversationId?: string };

export function encodeServerMessage(msg: ServerMessage): string {
  return JSON.stringify(msg);
}
