/**
 * One dedicated TCP connection to the C++ ThreadLink server per browser
 * session. Each browser session gets its own backend socket and its
 * own backend-assigned nickname — this lets the gateway lean entirely
 * on the C++ server's existing, tested nickname-uniqueness, broadcast,
 * and private-message machinery instead of re-implementing any of it.
 */
import { EventEmitter } from "node:events";
import { Socket } from "node:net";
import { FrameDecoder, writeFrame } from "./wireProtocol.js";
import { BackendEvent, parseBackendLine } from "./backendMessages.js";
import { logger } from "./logger.js";

export interface BackendConnectionEvents {
  event: [BackendEvent];
  close: [];
  error: [Error];
}

export declare interface BackendConnection {
  on<K extends keyof BackendConnectionEvents>(
    event: K,
    listener: (...args: BackendConnectionEvents[K]) => void,
  ): this;
  emit<K extends keyof BackendConnectionEvents>(
    event: K,
    ...args: BackendConnectionEvents[K]
  ): boolean;
}

export class BackendConnection extends EventEmitter {
  private socket: Socket | null = null;
  private decoder: FrameDecoder;
  private closed = false;

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly maxMessageBytes: number,
  ) {
    super();
    this.decoder = new FrameDecoder(maxMessageBytes);
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new Socket();
      this.socket = socket;

      const onConnectError = (err: Error) => {
        socket.removeAllListeners();
        reject(err);
      };

      socket.once("error", onConnectError);
      socket.connect(this.port, this.host, () => {
        socket.removeListener("error", onConnectError);
        this.wireSocket(socket);
        resolve();
      });
    });
  }

  private wireSocket(socket: Socket): void {
    socket.on("data", (chunk: Buffer) => {
      const { frames, error } = this.decoder.push(chunk);
      for (const frame of frames) {
        this.emit("event", parseBackendLine(frame.toString("utf8")));
      }
      if (error === "too_large") {
        logger.warn("backend sent an oversized frame; closing connection");
        this.close();
      }
    });

    socket.on("close", () => {
      if (!this.closed) {
        this.closed = true;
        this.emit("close");
      }
    });

    socket.on("error", (err: Error) => {
      logger.debug(`backend socket error: ${err.message}`);
      this.emit("error", err);
    });
  }

  /** Sends a raw line as one frame (plain chat text or a /command). */
  async sendLine(line: string): Promise<void> {
    if (!this.socket || this.closed) {
      throw new Error("backend connection is not open");
    }
    await writeFrame(this.socket, line);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.socket?.destroy();
  }
}
