import type {
  ClientOutbound,
  ParsedServerEvent,
  ServerInbound,
} from "@/types/protocol";

function parseTimestamp(value?: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function encodeOutbound(message: ClientOutbound): string {
  return JSON.stringify(message);
}

function mapStructuredInbound(message: ServerInbound): ParsedServerEvent[] {
  switch (message.type) {
    case "connected":
      return [
        {
          kind: "connected",
          nickname: message.nickname,
          message: message.message,
        },
      ];
    case "chat":
      return [
        {
          kind: "chat",
          from: message.from,
          content: message.content,
          timestamp: parseTimestamp(message.timestamp),
        },
      ];
    case "private":
      return [
        {
          kind: "private",
          from: message.from,
          to: message.to,
          content: message.content,
          timestamp: parseTimestamp(message.timestamp),
        },
      ];
    case "system":
      return [
        {
          kind: "system",
          content: message.content,
          timestamp: parseTimestamp(message.timestamp),
        },
      ];
    case "error":
      return [
        {
          kind: "error",
          content: message.content,
          timestamp: parseTimestamp(message.timestamp),
        },
      ];
    case "users":
      return [{ kind: "users", users: message.users }];
    case "nick":
      return [
        {
          kind: "nick",
          oldNickname: message.oldNickname,
          newNickname: message.newNickname,
          timestamp: parseTimestamp(message.timestamp),
        },
      ];
    case "raw":
      return parseRawPayload(message.payload);
    default:
      return [];
  }
}

/** Parse legacy TCP text payloads bridged by the gateway. */
export function parseRawPayload(payload: string): ParsedServerEvent[] {
  const text = payload.trim();
  if (!text) return [];

  if (text.startsWith("Welcome!")) {
    const match = text.match(/Your nickname is ([^.]+)\./i);
    return [
      {
        kind: "connected",
        nickname: match?.[1]?.trim() || "User",
        message: text,
      },
    ];
  }

  if (text.startsWith("(private) ")) {
    const body = text.slice("(private) ".length);
    const colonIndex = body.indexOf(": ");
    if (colonIndex === -1) {
      return [{ kind: "private", from: "unknown", content: body }];
    }
    return [
      {
        kind: "private",
        from: body.slice(0, colonIndex),
        content: body.slice(colonIndex + 2),
      },
    ];
  }

  if (text.startsWith("Server: Users online - ")) {
    const list = text.slice("Server: Users online - ".length);
    const users = list
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
    return [{ kind: "users", users }];
  }

  if (text.startsWith("Server: Error - ")) {
    return [{ kind: "error", content: text.slice("Server: ".length) }];
  }

  if (text.startsWith("Server: ") && text.includes(" is now known as ")) {
    const body = text.slice("Server: ".length);
    const [oldNickname, rest] = body.split(" is now known as ");
    const newNickname = rest?.replace(/\.$/, "").trim();
    if (oldNickname && newNickname) {
      return [{ kind: "nick", oldNickname, newNickname }];
    }
  }

  if (text.startsWith("Server: ")) {
    return [{ kind: "system", content: text.slice("Server: ".length) }];
  }

  const colonIndex = text.indexOf(": ");
  if (colonIndex > 0) {
    return [
      {
        kind: "chat",
        from: text.slice(0, colonIndex),
        content: text.slice(colonIndex + 2),
      },
    ];
  }

  return [{ kind: "system", content: text }];
}

export function parseInbound(data: string): ParsedServerEvent[] {
  try {
    const parsed = JSON.parse(data) as ServerInbound | ServerInbound[];
    if (Array.isArray(parsed)) {
      return parsed.flatMap((item) => mapStructuredInbound(item));
    }
    return mapStructuredInbound(parsed);
  } catch {
    return parseRawPayload(data);
  }
}

export function buildOutboundChat(content: string): ClientOutbound {
  return { type: "chat", content };
}

export function buildOutboundNick(nickname: string): ClientOutbound {
  return { type: "nick", nickname };
}

export function buildOutboundPrivate(
  to: string,
  content: string,
): ClientOutbound {
  return { type: "private", to, content };
}

export function buildOutboundList(): ClientOutbound {
  return { type: "list" };
}
