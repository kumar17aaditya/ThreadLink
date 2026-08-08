import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import { BackendConnection } from "./backendConnection.js";
import type { ClientMessage, Presence } from "./clientProtocol.js";

/**
 * One browser session: a WebSocket to the client and its own dedicated
 * TCP connection to the C++ backend. `id` is the gateway-issued stable
 * user identity for this session's lifetime (survives nickname
 * changes; does NOT survive reconnects — a new WS connection is a new
 * session/identity, same as a fresh backend TCP connection would be).
 */
export class Session {
  readonly id: string = randomUUID();
  readonly backend: BackendConnection;
  nickname = "";
  presence: Presence = "online";
  welcomed = false;
  closed = false;

  /** Client messages received before the backend WELCOME arrives are
   * queued and replayed once the session is ready, so the gateway
   * doesn't depend on frontend message ordering assumptions. */
  private pending: ClientMessage[] = [];

  constructor(
    readonly ws: WebSocket,
    backendHost: string,
    backendPort: number,
    backendMaxMessageBytes: number,
  ) {
    this.backend = new BackendConnection(backendHost, backendPort, backendMaxMessageBytes);
  }

  queueUntilReady(message: ClientMessage): void {
    this.pending.push(message);
  }

  drainQueue(): ClientMessage[] {
    const queued = this.pending;
    this.pending = [];
    return queued;
  }
}
