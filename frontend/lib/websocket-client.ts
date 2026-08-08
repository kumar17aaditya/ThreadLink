import {
  encodeOutbound,
  parseInbound,
} from "@/types/protocol";
import type {
  ClientMessage,
  ConnectionStatus,
  MessageTarget,
  ServerMessage,
} from "@/types/protocol";

export interface ThreadLinkClientOptions {
  url: string;
  onStatusChange: (status: ConnectionStatus) => void;
  onEvent: (event: ServerMessage) => void;
  onError: (message: string) => void;
  reconnect?: boolean;
  maxReconnectAttempts?: number;
}

/** Thin WebSocket transport: connection lifecycle + reconnect backoff
 * + encode/decode. No chat logic lives here -- that's ChatProvider's
 * job (see the layering note in ChatProvider.tsx). */
export class ThreadLinkClient {
  private socket: WebSocket | null = null;
  private url: string;
  private status: ConnectionStatus = "idle";
  private reconnectEnabled: boolean;
  private maxReconnectAttempts: number;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;

  private readonly onStatusChange: (status: ConnectionStatus) => void;
  private readonly onEvent: (event: ServerMessage) => void;
  private readonly onError: (message: string) => void;

  constructor(options: ThreadLinkClientOptions) {
    this.url = options.url;
    this.onStatusChange = options.onStatusChange;
    this.onEvent = options.onEvent;
    this.onError = options.onError;
    this.reconnectEnabled = options.reconnect ?? true;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 5;
  }

  connect(): void {
    this.intentionalClose = false;
    this.clearReconnectTimer();
    this.closeSocket(false);
    this.setStatus("connecting");

    try {
      this.socket = new WebSocket(this.url);
    } catch (error) {
      this.setStatus("failed");
      this.onError(error instanceof Error ? error.message : "Unable to open WebSocket");
      return;
    }

    this.socket.onopen = () => {
      this.reconnectAttempts = 0;
      this.setStatus("connected");
    };

    this.socket.onmessage = (event) => {
      const payload = typeof event.data === "string" ? event.data : "";
      if (!payload) return;
      const parsed = parseInbound(payload);
      if (parsed) this.onEvent(parsed);
    };

    this.socket.onerror = () => {
      if (this.status === "connecting") this.setStatus("failed");
      this.onError("WebSocket connection error");
    };

    this.socket.onclose = () => {
      this.socket = null;
      if (this.intentionalClose) {
        this.setStatus("disconnected");
        return;
      }
      if (this.reconnectEnabled && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.scheduleReconnect();
        return;
      }
      this.setStatus(this.reconnectAttempts > 0 ? "failed" : "disconnected");
    };
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.clearReconnectTimer();
    this.closeSocket(true);
    this.setStatus("disconnected");
  }

  setNickname(nickname: string): boolean {
    return this.send({ type: "setNickname", nickname });
  }

  register(username: string, password: string): boolean {
    return this.send({ type: "register", username, password });
  }

  login(username: string, password: string): boolean {
    return this.send({ type: "login", username, password });
  }

  logout(): boolean {
    return this.send({ type: "logout" });
  }

  sendMessage(target: MessageTarget, text: string): boolean {
    return this.send({ type: "sendMessage", target, text });
  }

  createGroup(name: string, memberIds: string[]): boolean {
    return this.send({ type: "createGroup", name, memberIds });
  }

  setPresence(presence: "online" | "away"): boolean {
    return this.send({ type: "setPresence", presence });
  }

  requestState(): boolean {
    return this.send({ type: "requestState" });
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  isConnected(): boolean {
    return this.status === "connected" && this.socket?.readyState === WebSocket.OPEN;
  }

  private send(message: ClientMessage): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.onError("Not connected to gateway");
      return false;
    }
    this.socket.send(encodeOutbound(message));
    return true;
  }

  private scheduleReconnect(): void {
    this.setStatus("reconnecting");
    this.reconnectAttempts += 1;
    const delay = Math.min(1000 * 2 ** (this.reconnectAttempts - 1), 10000);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private closeSocket(updateStatus: boolean): void {
    if (!this.socket) return;
    const socket = this.socket;
    this.socket = null;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
    if (updateStatus && this.status !== "failed") {
      this.setStatus("disconnected");
    }
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.onStatusChange(status);
  }
}
