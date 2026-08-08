/**
 * Browser <-> gateway JSON protocol types. Mirrors
 * docs/GATEWAY_PROTOCOL.md and gateway/src/clientProtocol.ts exactly
 * -- keep all three in sync. The gateway always speaks structured
 * JSON; there is no legacy raw-text fallback to parse here anymore.
 */

export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "reconnecting"
  | "failed";

export type Presence = "online" | "away" | "offline";

export type MessageTarget =
  | { kind: "public" }
  | { kind: "direct"; peerId: string }
  | { kind: "group"; groupId: string };

/** Client -> gateway */
export type ClientMessage =
  | { type: "register"; username: string; password: string }
  | { type: "login"; username: string; password: string }
  | { type: "logout" }
  | { type: "setNickname"; nickname: string }
  | { type: "sendMessage"; target: MessageTarget; text: string }
  | { type: "createGroup"; name: string; memberIds: string[] }
  | { type: "setPresence"; presence: "online" | "away" }
  | { type: "requestState" };

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

/** Gateway -> client */
export type ServerMessage =
  | {
      type: "ready";
      userId: string;
      username: string;
      users: UserSummary[];
      conversations: ConversationSummary[];
      /** Full persisted message history across every conversation the
       * user belongs to, oldest first -- restores all conversation
       * views in one round trip after login. */
      messages: MessageSummary[];
    }
  | { type: "loggedOut" }
  | { type: "userUpdate"; user: UserSummary }
  | { type: "userOffline"; userId: string }
  | { type: "conversationCreated"; conversation: ConversationSummary }
  | { type: "message"; message: MessageSummary }
  | { type: "error"; code: string; message: string; conversationId?: string };

export function encodeOutbound(message: ClientMessage): string {
  return JSON.stringify(message);
}

/** Parses one gateway->client frame. Returns null (and logs) for
 * anything that isn't valid JSON or doesn't look like a ServerMessage
 * -- the gateway is trusted here (unlike the gateway's own inbound
 * validation of untrusted browser input), so this is a defensive
 * sanity check rather than a full schema validator. */
export function parseInbound(data: string): ServerMessage | null {
  try {
    const parsed = JSON.parse(data) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>)["type"] === "string"
    ) {
      return parsed as ServerMessage;
    }
    console.warn("Received a gateway message with no recognizable type:", parsed);
    return null;
  } catch {
    console.warn("Received a non-JSON gateway message:", data);
    return null;
  }
}
