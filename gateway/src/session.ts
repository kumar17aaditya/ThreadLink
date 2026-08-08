import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import { BackendConnection } from "./backendConnection.js";
import type { ClientMessage, Presence } from "./clientProtocol.js";

/**
 * One browser session: a WebSocket to the client, and (once
 * authenticated) its own dedicated TCP connection to the C++ backend.
 *
 * `id` starts as a throwaway placeholder for a session that hasn't
 * logged in yet (never exposed to the client, never added to the
 * roster) and is replaced with the account's persistent user id
 * (see users.ts) on successful register/login -- from that point on
 * it's stable across reconnects, since it's the same DB row every
 * time that account logs in again.
 */
export class Session {
  id: string = `pending:${randomUUID()}`;
  authenticated = false;
  backend: BackendConnection | null = null;
  nickname = "";
  /** Set right after successful register/login to the account's
   * persisted username; cleared once the backend confirms the
   * matching nickname has actually been claimed (see gatewayServer's
   * "welcome"/"nick" handling). */
  desiredUsername: string | undefined = undefined;
  /** True once `ready` has been sent for this session -- guards
   * against re-announcing readiness if a rename happens later. */
  readyAnnounced = false;
  presence: Presence = "online";
  welcomed = false;
  closed = false;

  /** Client messages received before authentication completes (or,
   * post-auth, before the backend WELCOME arrives) are queued and
   * replayed once the session is ready, so the gateway doesn't depend
   * on frontend message ordering assumptions. */
  private pending: ClientMessage[] = [];

  constructor(
    readonly ws: WebSocket,
    private readonly backendHost: string,
    private readonly backendPort: number,
    private readonly backendMaxMessageBytes: number,
  ) {}

  /** Creates this session's dedicated backend connection. Only called
   * once, right after authentication succeeds. */
  createBackendConnection(): BackendConnection {
    this.backend = new BackendConnection(this.backendHost, this.backendPort, this.backendMaxMessageBytes);
    return this.backend;
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
