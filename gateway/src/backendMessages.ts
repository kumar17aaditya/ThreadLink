/**
 * Parses and formats the ThreadLink C++ server's line-based message
 * vocabulary, as documented in docs/PROTOCOL.md section 4 (server ->
 * client) and section 3 (client -> server). Each frame payload decoded
 * by wireProtocol.ts is one such line.
 */

export type BackendEvent =
  | { type: "welcome"; nickname: string }
  | { type: "sys"; text: string }
  | { type: "msg"; sender: string; text: string }
  | { type: "priv"; sender: string; text: string }
  | { type: "privSent"; recipient: string; text: string }
  | { type: "nick"; oldNick: string; newNick: string }
  | { type: "list"; count: number; names: string[] }
  | { type: "err"; code: string; text: string }
  | { type: "unknown"; raw: string };

function splitFirst(s: string): [string, string] {
  const idx = s.indexOf(" ");
  if (idx === -1) return [s, ""];
  return [s.slice(0, idx), s.slice(idx + 1)];
}

export function parseBackendLine(payload: string): BackendEvent {
  const [type, rest] = splitFirst(payload);

  switch (type) {
    case "WELCOME":
      return { type: "welcome", nickname: rest };
    case "SYS":
      return { type: "sys", text: rest };
    case "MSG": {
      const [sender, text] = splitFirst(rest);
      return { type: "msg", sender, text };
    }
    case "PRIV": {
      const [sender, text] = splitFirst(rest);
      return { type: "priv", sender, text };
    }
    case "PRIV_SENT": {
      const [recipient, text] = splitFirst(rest);
      return { type: "privSent", recipient, text };
    }
    case "NICK": {
      const [oldNick, newNick] = splitFirst(rest);
      return { type: "nick", oldNick, newNick };
    }
    case "LIST": {
      const [countStr, namesRest] = splitFirst(rest);
      const count = Number.parseInt(countStr, 10);
      const names = namesRest.length > 0 ? namesRest.split(" ") : [];
      return { type: "list", count: Number.isFinite(count) ? count : names.length, names };
    }
    case "ERR": {
      const [code, text] = splitFirst(rest);
      return { type: "err", code, text };
    }
    default:
      return { type: "unknown", raw: payload };
  }
}

// --- Outbound (gateway -> backend) command formatting ---

export function formatNickCommand(nickname: string): string {
  return `/nick ${nickname}`;
}

export function formatMsgCommand(targetNick: string, text: string): string {
  return `/msg ${targetNick} ${text}`;
}

export function formatListCommand(): string {
  return "/list";
}

export function formatChatLine(text: string): string {
  // Plain text (no leading '/') is broadcast as-is by the backend.
  return text;
}

export function formatExitCommand(): string {
  return "/exit";
}
