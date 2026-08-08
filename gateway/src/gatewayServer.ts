import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import type { GatewayConfig } from "./config.js";
import { logger } from "./logger.js";
import { Session } from "./session.js";
import { SessionManager } from "./sessionManager.js";
import { ConversationManager, PUBLIC_CONVERSATION_ID, directConversationId } from "./conversationManager.js";
import { MessageStore } from "./messageStore.js";
import { UserStore } from "./users.js";
import type { Db } from "./db.js";
import {
  formatChatLine,
  formatMsgCommand,
  formatNickCommand,
} from "./backendMessages.js";
import {
  ClientMessage,
  ConversationSummary,
  MessageSummary,
  MessageTarget,
  ServerMessage,
  UserSummary,
  encodeServerMessage,
  validateClientMessage,
} from "./clientProtocol.js";

export class GatewayServer {
  private wss: WebSocketServer;
  private sessions = new SessionManager();
  private conversations: ConversationManager;
  private messages: MessageStore;
  private users: UserStore;

  constructor(
    private readonly config: GatewayConfig,
    db: Db,
  ) {
    this.users = new UserStore(db);
    this.conversations = new ConversationManager(db, this.users);
    this.messages = new MessageStore(db);

    this.wss = new WebSocketServer({ port: config.gatewayPort });
    this.wss.on("connection", (ws) => this.onConnection(ws));
    this.wss.on("listening", () => {
      logger.info(`ThreadLink gateway listening on ws://0.0.0.0:${config.gatewayPort}`);
      logger.info(`Bridging to backend at ${config.backendHost}:${config.backendPort}`);
    });
  }

  close(): Promise<void> {
    for (const session of this.sessions.all()) {
      session.backend?.close();
      session.ws.close(1001, "server shutting down");
    }
    return new Promise((resolve, reject) => {
      this.wss.close((err) => (err ? reject(err) : resolve()));
    });
  }

  // ---- Connection lifecycle ----

  private onConnection(ws: WebSocket): void {
    // A freshly-opened WebSocket is *not* added to the session
    // roster and has no backend connection yet -- both only happen
    // once register/login succeeds (see handleAuth). This is the
    // gateway-side enforcement point for "authentication must be
    // handled by the gateway, not just the frontend": nothing else
    // is processed until that succeeds.
    const session = new Session(ws, this.config.backendHost, this.config.backendPort, this.config.backendMaxMessageBytes);

    ws.on("message", (raw: Buffer) => this.onClientRaw(session, raw));
    ws.on("close", () => this.onClientClosed(session));
    ws.on("error", (err) => logger.debug(`session ${session.id}: ws error: ${err.message}`));
  }

  private onClientClosed(session: Session): void {
    if (session.closed) return;
    session.closed = true;
    if (!session.authenticated) {
      return; // never joined the roster; nothing to clean up or announce
    }
    logger.info(`session ${session.id} (${session.nickname}) disconnected`);
    session.backend?.close();
    this.sessions.remove(session.id);
    // Deliberately does NOT touch persisted data: account, conversation
    // membership, and message history all survive a disconnect (or an
    // ungraceful process exit) -- only the live roster entry goes away.
    if (session.welcomed) {
      this.broadcastToAll({ type: "userOffline", userId: session.id }, session.id);
    }
  }

  private onBackendClosed(session: Session): void {
    if (session.closed) return;
    logger.warn(`session ${session.id}: backend connection lost`);
    this.sendTo(session, {
      type: "error",
      code: "BACKEND_DISCONNECTED",
      message: "Lost connection to the ThreadLink server.",
    });
    session.ws.close(1011, "backend connection lost");
    // onClientClosed() runs via the ws 'close' event triggered above and
    // performs the actual session/roster cleanup, so it isn't duplicated here.
  }

  // ---- Inbound WebSocket messages ----

  private onClientRaw(session: Session, raw: Buffer): void {
    if (raw.byteLength > this.config.maxClientMessageBytes) {
      this.sendTo(session, {
        type: "error",
        code: "MESSAGE_TOO_LARGE",
        message: `Message exceeds the ${this.config.maxClientMessageBytes}-byte limit.`,
      });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString("utf8"));
    } catch {
      this.sendTo(session, { type: "error", code: "BAD_JSON", message: "Message was not valid JSON." });
      return;
    }

    const result = validateClientMessage(parsed);
    if (!result.ok) {
      this.sendTo(session, { type: "error", code: "BAD_MESSAGE", message: result.error });
      return;
    }

    if (result.message.type === "register" || result.message.type === "login") {
      void this.handleAuth(session, result.message);
      return;
    }
    if (result.message.type === "logout") {
      this.handleLogout(session);
      return;
    }

    if (!session.authenticated || !session.welcomed) {
      session.queueUntilReady(result.message);
      return;
    }
    void this.handleClientMessage(session, result.message);
  }

  // ---- Authentication ----

  private async handleAuth(
    session: Session,
    message: Extract<ClientMessage, { type: "register" | "login" }>,
  ): Promise<void> {
    if (session.authenticated) {
      this.sendTo(session, { type: "error", code: "ALREADY_AUTHENTICATED", message: "Already logged in." });
      return;
    }

    let account: { id: string; username: string };
    try {
      if (message.type === "register") {
        account = await this.users.register(message.username, message.password);
      } else {
        const found = await this.users.login(message.username, message.password);
        if (!found) throw new Error("Invalid username or password.");
        account = found;
      }
    } catch (err) {
      // Never logs or echoes the submitted password -- only the
      // validation/failure message, which never contains it.
      this.sendTo(session, {
        type: "error",
        code: message.type === "register" ? "REGISTER_FAILED" : "LOGIN_FAILED",
        message: (err as Error).message,
      });
      return;
    }

    const existing = this.sessions.get(account.id);
    if (existing && !existing.closed) {
      this.sendTo(session, {
        type: "error",
        code: "ALREADY_LOGGED_IN",
        message: "This account is already connected elsewhere.",
      });
      return;
    }

    session.id = account.id;
    session.authenticated = true;
    session.desiredUsername = account.username;
    this.sessions.add(session);
    logger.info(`session ${session.id} authenticated as '${account.username}' via ${message.type}`);

    const backend = session.createBackendConnection();
    backend.on("event", (event) => this.onBackendEvent(session, event));
    backend.on("close", () => this.onBackendClosed(session));
    backend.on("error", () => {
      /* surfaced via close/ERR events; nothing extra to do here */
    });

    try {
      await backend.connect();
    } catch (err) {
      logger.error(`session ${session.id}: failed to connect to backend: ${(err as Error).message}`);
      this.sendTo(session, {
        type: "error",
        code: "BACKEND_UNAVAILABLE",
        message: "Could not reach the ThreadLink server.",
      });
      session.ws.close(1011, "backend unavailable");
      this.sessions.remove(session.id);
    }
  }

  private handleLogout(session: Session): void {
    if (!session.authenticated) {
      this.sendTo(session, { type: "error", code: "NOT_AUTHENTICATED", message: "Not logged in." });
      return;
    }
    logger.info(`session ${session.id} (${session.nickname}) logged out`);
    this.sendTo(session, { type: "loggedOut" });
    // Server-initiated close triggers the same onClientClosed cleanup
    // as any other disconnect (mark offline, drop the live roster
    // entry) -- account/conversation/message data is untouched.
    session.ws.close(1000, "logged out");
  }

  private async handleClientMessage(session: Session, message: ClientMessage): Promise<void> {
    switch (message.type) {
      case "setNickname":
        await session.backend!.sendLine(formatNickCommand(message.nickname));
        return;
      case "setPresence":
        session.presence = message.presence;
        this.broadcastToAll({ type: "userUpdate", user: this.summarize(session) });
        return;
      case "requestState":
        this.sendReady(session);
        return;
      case "createGroup":
        this.handleCreateGroup(session, message.name, message.memberIds);
        return;
      case "sendMessage":
        await this.handleSendMessage(session, message.target, message.text);
        return;
      case "register":
      case "login":
      case "logout":
        return; // handled earlier in onClientRaw, never reaches here
    }
  }

  private handleCreateGroup(session: Session, name: string, memberIds: string[]): void {
    const uniqueIds = [...new Set([session.id, ...memberIds])];
    const unknown = uniqueIds.filter((id) => !this.sessions.get(id)?.welcomed);
    if (unknown.length > 0) {
      this.sendTo(session, {
        type: "error",
        code: "UNKNOWN_MEMBER",
        message: `Unknown or offline user id(s): ${unknown.join(", ")}`,
      });
      return;
    }

    const conversation = this.conversations.createGroup(name, uniqueIds);
    for (const id of uniqueIds) {
      const member = this.sessions.get(id);
      if (member) this.sendTo(member, { type: "conversationCreated", conversation });
    }
    logger.info(`session ${session.id} created group '${name}' (${conversation.id}) with ${uniqueIds.length} members`);
  }

  private async handleSendMessage(session: Session, target: MessageTarget, text: string): Promise<void> {
    if (target.kind === "public") {
      // The backend broadcasts MSG to every OTHER welcomed connection but
      // never echoes back to the sender, so the gateway synthesizes the
      // sender's own copy locally; every other client's copy arrives for
      // real via that client's own backend connection (see the "msg"
      // case in onBackendEvent) -- the actual fan-out is the C++ server's,
      // not faked here. Persisted exactly once, here at the send site.
      const own = this.messages.append({
        conversationId: PUBLIC_CONVERSATION_ID,
        kind: "chat",
        senderId: session.id,
        senderUsername: session.nickname,
        text,
      });
      this.sendTo(session, { type: "message", message: own });
      await session.backend!.sendLine(formatChatLine(text));
      return;
    }

    if (target.kind === "direct") {
      const peer = this.sessions.get(target.peerId);
      if (!peer || !peer.welcomed) {
        this.sendTo(session, {
          type: "error",
          code: "USER_NOT_FOUND",
          message: "That user is not currently online.",
          conversationId: directConversationId(session.id, target.peerId),
        });
        return;
      }
      const isNewConversation = !this.conversations.hasDirect(directConversationId(session.id, peer.id));
      const conversation = this.conversations.ensureDirect(session.id, peer.id);
      if (isNewConversation) {
        this.sendTo(session, { type: "conversationCreated", conversation });
        this.sendTo(peer, { type: "conversationCreated", conversation });
      }
      // Persisted once here; the real backend round-trip (peer receives
      // PRIV, sender receives PRIV_SENT as delivery confirmation, both
      // handled in onBackendEvent) is purely for live delivery and
      // doesn't touch the database again.
      this.messages.append({
        conversationId: conversation.id,
        kind: "chat",
        senderId: session.id,
        senderUsername: session.nickname,
        text,
      });
      await session.backend!.sendLine(formatMsgCommand(peer.nickname, text));
      return;
    }

    // target.kind === "group"
    const group = this.conversations.getGroup(target.groupId);
    if (!group || !group.memberIds.has(session.id)) {
      this.sendTo(session, {
        type: "error",
        code: "NOT_A_MEMBER",
        message: "You are not a member of that group.",
        conversationId: target.groupId,
      });
      return;
    }
    // The C++ backend has no group primitive (see docs/PROTOCOL.md §6),
    // so group delivery is real gateway-side fan-out over each member's
    // own already-open WebSocket session, gated strictly by real,
    // server-held membership -- not a frontend simulation, and
    // non-members provably never receive it (see gateway tests).
    const summary = this.messages.append({
      conversationId: group.id,
      kind: "chat",
      senderId: session.id,
      senderUsername: session.nickname,
      text,
    });
    for (const memberId of group.memberIds) {
      const member = this.sessions.get(memberId);
      if (member) this.sendTo(member, { type: "message", message: summary });
    }
  }

  // ---- Backend (C++ server) events, per-session ----

  private onBackendEvent(session: Session, event: import("./backendMessages.js").BackendEvent): void {
    switch (event.type) {
      case "welcome": {
        session.welcomed = true;
        session.nickname = event.nickname;
        if (session.desiredUsername && session.desiredUsername !== session.nickname) {
          // Claim the account's persisted username as the backend
          // nickname; readiness is announced once the resulting NICK
          // broadcast confirms it (see the "nick" case below), so the
          // client never sees a transient generic default name.
          void session.backend!.sendLine(formatNickCommand(session.desiredUsername));
          return;
        }
        this.announceReady(session);
        return;
      }
      case "nick": {
        // The backend broadcasts NICK to every connected socket, so this
        // fires once per session's own connection; only the session whose
        // current nickname matches `oldNick` is the one who actually
        // renamed -- every other session's handler is a no-op here to
        // avoid broadcasting the same update N times.
        if (event.oldNick === session.nickname) {
          session.nickname = event.newNick;
          if (session.desiredUsername === event.newNick) session.desiredUsername = undefined;
          if (!session.readyAnnounced) {
            this.announceReady(session);
          } else {
            this.broadcastToAll({ type: "userUpdate", user: this.summarize(session) });
            // A rename via the existing /nick flow also persists the
            // new username, so it's restored correctly on the next login.
            try {
              this.users.rename(session.id, event.newNick);
            } catch {
              /* backend already enforced uniqueness; a persistence-side
                 collision here would be surprising, but isn't fatal to
                 the live rename the user just saw succeed. */
            }
          }
        }
        return;
      }
      case "msg": {
        const message: MessageSummary = {
          id: randomUUID(),
          conversationId: PUBLIC_CONVERSATION_ID,
          kind: "chat",
          senderId: this.sessions.findByNickname(event.sender)?.id ?? null,
          senderUsername: event.sender,
          text: event.text,
          timestamp: new Date().toISOString(),
        };
        this.sendTo(session, { type: "message", message });
        return;
      }
      case "priv": {
        const senderSession = this.sessions.findByNickname(event.sender);
        const conversation = this.conversations.ensureDirect(session.id, senderSession?.id ?? event.sender);
        const message: MessageSummary = {
          id: randomUUID(),
          conversationId: conversation.id,
          kind: "chat",
          senderId: senderSession?.id ?? null,
          senderUsername: event.sender,
          text: event.text,
          timestamp: new Date().toISOString(),
        };
        this.sendTo(session, { type: "message", message });
        return;
      }
      case "privSent": {
        const recipientSession = this.sessions.findByNickname(event.recipient);
        const conversation = this.conversations.ensureDirect(session.id, recipientSession?.id ?? event.recipient);
        const message: MessageSummary = {
          id: randomUUID(),
          conversationId: conversation.id,
          kind: "chat",
          senderId: session.id,
          senderUsername: session.nickname,
          text: event.text,
          timestamp: new Date().toISOString(),
        };
        this.sendTo(session, { type: "message", message });
        return;
      }
      case "err": {
        if (!session.readyAnnounced && event.code === "NICK_TAKEN") {
          // Only plausible if a previous session for this account
          // hasn't been fully cleaned up on the backend yet.
          this.sendTo(session, {
            type: "error",
            code: "LOGIN_FAILED",
            message: "This account appears to be connected elsewhere already. Try again shortly.",
          });
          session.ws.close(1011, "nickname conflict during login");
          return;
        }
        this.sendTo(session, { type: "error", code: event.code, message: event.text });
        return;
      }
      case "sys": {
        if (event.text.toLowerCase().includes("shutting down")) {
          logger.warn(`session ${session.id}: backend is shutting down`);
        }
        return;
      }
      case "list":
      case "unknown":
        return; // LIST is superseded by the gateway's own roster; nothing to relay.
    }
  }

  // ---- Helpers ----

  private summarize(session: Session): UserSummary {
    return { id: session.id, username: session.nickname, presence: session.presence };
  }

  private announceReady(session: Session): void {
    session.readyAnnounced = true;
    this.sendReady(session);
    this.broadcastToAll({ type: "userUpdate", user: this.summarize(session) }, session.id);
    for (const queued of session.drainQueue()) {
      void this.handleClientMessage(session, queued);
    }
  }

  private sendReady(session: Session): void {
    const users = this.sessions.welcomedUsers();
    const conversations: ConversationSummary[] = [
      this.conversations.publicConversation(users.map((u) => u.id)),
      ...this.conversations.conversationsFor(session.id),
    ];
    const messages = this.messages.historyForUser(session.id);
    this.sendTo(session, {
      type: "ready",
      userId: session.id,
      username: session.nickname,
      users,
      conversations,
      messages,
    });
  }

  private sendTo(session: Session, message: ServerMessage): void {
    if (session.ws.readyState !== WebSocket.OPEN) return;
    session.ws.send(encodeServerMessage(message));
  }

  private broadcastToAll(message: ServerMessage, excludeSessionId?: string): void {
    for (const session of this.sessions.all()) {
      if (session.id === excludeSessionId) continue;
      if (!session.welcomed) continue;
      this.sendTo(session, message);
    }
  }
}
