import {
  buildOutboundChat,
  buildOutboundList,
  buildOutboundNick,
  buildOutboundPrivate,
  encodeOutbound,
  parseInbound,
} from "@/lib/protocol";
import type { ConnectionStatus, ParsedServerEvent } from "@/types/protocol";

export interface ThreadLinkClientOptions {
  url: string;
  onStatusChange: (status: ConnectionStatus) => void;
  onEvent: (events: ParsedServerEvent[]) => void;
  onError: (message: string) => void;
  reconnect?: boolean;
  maxReconnectAttempts?: number;
}

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
  private readonly onEvent: (events: ParsedServerEvent[]) => void;
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
      this.onError(
        error instanceof Error ? error.message : "Unable to open WebSocket",
      );
      return;
    }

    this.socket.onopen = () => {
      this.reconnectAttempts = 0;
      this.setStatus("connected");
    };

    this.socket.onmessage = (event) => {
      const payload = typeof event.data === "string" ? event.data : "";
      if (!payload) return;
      this.onEvent(parseInbound(payload));
    };

    this.socket.onerror = () => {
      if (this.status === "connecting") {
        this.setStatus("failed");
      }
      this.onError("WebSocket connection error");
    };

    this.socket.onclose = () => {
      this.socket = null;
      if (this.intentionalClose) {
        this.setStatus("disconnected");
        return;
      }

      if (
        this.reconnectEnabled &&
        this.reconnectAttempts < this.maxReconnectAttempts
      ) {
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

  sendChat(content: string): boolean {
    return this.send(buildOutboundChat(content));
  }

  sendNick(nickname: string): boolean {
    return this.send(buildOutboundNick(nickname));
  }

  sendPrivate(to: string, content: string): boolean {
    return this.send(buildOutboundPrivate(to, content));
  }

  requestUserList(): boolean {
    return this.send(buildOutboundList());
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  isConnected(): boolean {
    return (
      this.status === "connected" &&
      this.socket?.readyState === WebSocket.OPEN
    );
  }

  private send(payload: Parameters<typeof encodeOutbound>[0]): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.onError("Not connected to gateway");
      return false;
    }

    this.socket.send(encodeOutbound(payload));
    return true;
  }

  private scheduleReconnect(): void {
    this.setStatus("reconnecting");
    this.reconnectAttempts += 1;
    const delay = Math.min(1000 * 2 ** (this.reconnectAttempts - 1), 10000);

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
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
    if (
      socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING
    ) {
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
