/** WebSocket protocol types — must stay aligned with docs/PROTOCOL.md when available. */

export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "reconnecting"
  | "failed";

/** Client → gateway */
export type ClientOutbound =
  | { type: "chat"; content: string }
  | { type: "nick"; nickname: string }
  | { type: "private"; to: string; content: string }
  | { type: "list" };

/** Gateway → client (structured JSON envelope) */
export type ServerInbound =
  | { type: "connected"; nickname: string; message?: string }
  | { type: "chat"; from: string; content: string; timestamp?: string }
  | {
      type: "private";
      from: string;
      to?: string;
      content: string;
      timestamp?: string;
    }
  | { type: "system"; content: string; timestamp?: string }
  | { type: "error"; content: string; timestamp?: string }
  | { type: "users"; users: string[] }
  | {
      type: "nick";
      oldNickname: string;
      newNickname: string;
      timestamp?: string;
    }
  | { type: "raw"; payload: string };

export type ParsedServerEvent =
  | { kind: "connected"; nickname: string; message?: string }
  | { kind: "chat"; from: string; content: string; timestamp?: Date }
  | { kind: "private"; from: string; to?: string; content: string; timestamp?: Date }
  | { kind: "system"; content: string; timestamp?: Date }
  | { kind: "error"; content: string; timestamp?: Date }
  | { kind: "users"; users: string[] }
  | { kind: "nick"; oldNickname: string; newNickname: string; timestamp?: Date };
