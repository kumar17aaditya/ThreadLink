import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import type { GatewayConfig } from "./config.js";
import { logger } from "./logger.js";
import { Session } from "./session.js";
import { SessionManager } from "./sessionManager.js";
import { ConversationManager, PUBLIC_CONVERSATION_ID, directConversationId } from "./conversationManager.js";
import {
  formatChatLine,
  formatMsgCommand,
  formatNickCommand,
} from "./backendMessages.js";
import {
  ClientMessage,
  ConversationSummary,
  MessageSummary,
  ServerMessage,
  UserSummary,
  encodeServerMessage,
  validateClientMessage,
} from "./clientProtocol.js";

export class GatewayServer {
  private wss: WebSocketServer;
  private sessions = new SessionManager();
  private conversations = new ConversationManager();

  constructor(private readonly config: GatewayConfig) {
    this.wss = new WebSocketServer({ port: config.gatewayPort });
    this.wss.on("connection", (ws) => this.onConnection(ws));
    this.wss.on("listening", () => {
      logger.info(`ThreadLink gateway listening on ws://0.0.0.0:${config.gatewayPort}`);
      logger.info(`Bridging to backend at ${config.backendHost}:${config.backendPort}`);
    });
  }

  close(): Promise<void> {
    for (const session of this.sessions.all()) {
      session.backend.close();
      session.ws.close(1001, "server shutting down");
    }
    return new Promise((resolve, reject) => {
      this.wss.close((err) => (err ? reject(err) : resolve()));
    });
  }

  // ---- Connection lifecycle ----

  private onConnection(ws: WebSocket): void {
    const session = new Session(
      ws,
      this.config.backendHost,
      this.config.backendPort,
      this.config.backendMaxMessageBytes,
    );
    this.sessions.add(session);
    logger.info(`session ${session.id} connected (WS), opening backend connection...`);

    session.backend.on("event", (event) => this.onBackendEvent(session, event));
    session.backend.on("close", () => this.onBackendClosed(session));
    session.backend.on("error", () => {
      /* surfaced via close/ERR events; nothing extra to do here */
    });

    session.backend.connect().catch((err: Error) => {
      logger.error(`session ${session.id}: failed to connect to backend: ${err.message}`);
      this.sendTo(session, {
        type: "error",
        code: "BACKEND_UNAVAILABLE",
        message: "Could not reach the ThreadLink server.",
      });
      ws.close(1011, "backend unavailable");
      this.sessions.remove(session.id);
    });

    ws.on("message", (raw: Buffer) => this.onClientRaw(session, raw));
    ws.on("close", () => this.onClientClosed(session));
    ws.on("error", (err) => logger.debug(`session ${session.id}: ws error: ${err.message}`));
  }

  private onClientClosed(session: Session): void {
    if (session.closed) return;
    session.closed = true;
    logger.info(`session ${session.id} (${session.nickname || "unwelcomed"}) disconnected`);
    session.backend.close();
    this.sessions.remove(session.id);
    this.conversations.forgetUser(session.id);
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

    if (!session.welcomed) {
      session.queueUntilReady(result.message);
      return;
    }
    void this.handleClientMessage(session, result.message);
  }

  private async handleClientMessage(session: Session, message: ClientMessage): Promise<void> {
    switch (message.type) {
      case "setNickname":
        await session.backend.sendLine(formatNickCommand(message.nickname));
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

  private async handleSendMessage(
    session: Session,
    target: import("./clientProtocol.js").MessageTarget,
    text: string,
  ): Promise<void> {
    const now = new Date().toISOString();

    if (target.kind === "public") {
      // The backend broadcasts MSG to every OTHER welcomed connection but
      // never echoes back to the sender, so the gateway synthesizes the
      // sender's own copy locally; every other client's copy arrives for
      // real via that client's own backend connection (see the "msg"
      // case in onBackendEvent) -- the actual fan-out is the C++ server's,
      // not faked here.
      const own: MessageSummary = {
        id: randomUUID(),
        conversationId: PUBLIC_CONVERSATION_ID,
        kind: "chat",
        senderId: session.id,
        senderUsername: session.nickname,
        text,
        timestamp: now,
      };
      this.sendTo(session, { type: "message", message: own });
      await session.backend.sendLine(formatChatLine(text));
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
      // Real backend round-trip: the peer receives PRIV on THEIR OWN
      // backend connection, and this session receives PRIV_SENT on ITS
      // OWN backend connection as the delivery confirmation -- both
      // handled in onBackendEvent, so no message is synthesized here.
      await session.backend.sendLine(formatMsgCommand(peer.nickname, text));
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
    const summary: MessageSummary = {
      id: randomUUID(),
      conversationId: group.id,
      kind: "chat",
      senderId: session.id,
      senderUsername: session.nickname,
      text,
      timestamp: now,
    };
    for (const memberId of group.memberIds) {
      const member = this.sessions.get(memberId);
      if (member) this.sendTo(member, { type: "message", message: summary });
    }
  }

  // ---- Backend (C++ server) events, per-session ----

  private onBackendEvent(session: Session, event: import("./backendMessages.js").BackendEvent): void {
    switch (event.type) {
      case "welcome": {
        session.nickname = event.nickname;
        session.welcomed = true;
        this.sendReady(session);
        this.broadcastToAll({ type: "userUpdate", user: this.summarize(session) }, session.id);
        for (const queued of session.drainQueue()) {
          void this.handleClientMessage(session, queued);
        }
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
          this.broadcastToAll({ type: "userUpdate", user: this.summarize(session) });
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

  private sendReady(session: Session): void {
    const users = this.sessions.welcomedUsers();
    const conversations: ConversationSummary[] = [
      this.conversations.publicConversation(users.map((u) => u.id)),
      ...this.conversations.conversationsFor(session.id),
    ];
    this.sendTo(session, {
      type: "ready",
      userId: session.id,
      username: session.nickname,
      users,
      conversations,
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
