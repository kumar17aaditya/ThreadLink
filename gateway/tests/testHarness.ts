import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { GatewayServer } from "../src/gatewayServer.js";
import { openDatabase } from "../src/db.js";
import type { GatewayConfig } from "../src/config.js";
import { logger } from "../src/logger.js";

logger.setMinLevel("error"); // keep test output focused on assertions, not gateway chatter

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const BACKEND_BIN = path.join(REPO_ROOT, "server");

export function waitForPort(port: number, host = "127.0.0.1", timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    function attempt() {
      const sock = net.createConnection(port, host);
      sock.once("connect", () => {
        sock.end();
        resolve();
      });
      sock.once("error", () => {
        sock.destroy();
        if (Date.now() > deadline) reject(new Error(`timed out waiting for ${host}:${port}`));
        else setTimeout(attempt, 30);
      });
    }
    attempt();
  });
}

export interface TestBackend {
  proc: ChildProcessWithoutNullStreams;
  port: number;
  dir: string;
  stop(): Promise<void>;
}

let nextPort = 18100;
/** Hands out a fresh port per test so tests can run without colliding,
 * without needing a real ephemeral-port allocator. */
export function allocatePortPair(): { backendPort: number; gatewayPort: number } {
  const backendPort = nextPort++;
  const gatewayPort = nextPort++;
  return { backendPort, gatewayPort };
}

export async function startBackend(port: number, maxMessageSize = 8192): Promise<TestBackend> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "threadlink-e2e-"));
  fs.writeFileSync(
    path.join(dir, "server.conf"),
    `PORT=${port}\nMAX_CLIENTS=50\nMAX_MESSAGE_SIZE=${maxMessageSize}\nLOG_LEVEL=WARN\n`,
  );
  const proc = spawn(BACKEND_BIN, [], { cwd: dir, stdio: ["pipe", "pipe", "pipe"] }) as ChildProcessWithoutNullStreams;
  proc.stdout.on("data", () => {});
  proc.stderr.on("data", () => {});
  await waitForPort(port);
  return {
    proc,
    port,
    dir,
    async stop() {
      try {
        proc.stdin.write("SHUTDOWN\n");
      } catch {
        /* already gone */
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          proc.kill("SIGKILL");
          resolve();
        }, 2000);
        proc.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function startGateway(config: GatewayConfig): GatewayServer {
  const db = openDatabase(config.dbPath);
  return new GatewayServer(config, db);
}

export function defaultTestConfig(backendPort: number, gatewayPort: number, dbPath = ":memory:"): GatewayConfig {
  return {
    gatewayPort,
    backendHost: "127.0.0.1",
    backendPort,
    maxClientMessageBytes: 16 * 1024,
    backendMaxMessageBytes: 8192,
    logLevel: "error",
    dbPath,
  };
}

export class TestClient {
  events: unknown[] = [];
  private constructor(public readonly ws: WebSocket) {
    ws.on("message", (raw: Buffer) => {
      this.events.push(JSON.parse(raw.toString("utf8")));
    });
  }

  static async connect(gatewayPort: number): Promise<TestClient> {
    const ws = new WebSocket(`ws://127.0.0.1:${gatewayPort}`);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    return new TestClient(ws);
  }

  send(message: unknown): void {
    this.ws.send(JSON.stringify(message));
  }

  /** Registers, then waits for either `ready` (success) or `error`
   * (failure) -- whichever arrives, so tests can assert on either
   * outcome without guessing which one to wait for. */
  async register(username: string, password: string): Promise<unknown> {
    this.send({ type: "register", username, password });
    return this.waitFor(
      (e): e is { type: "ready" | "error" } =>
        isType("ready")(e) || isType("error")(e),
    );
  }

  async login(username: string, password: string): Promise<unknown> {
    this.send({ type: "login", username, password });
    return this.waitFor(
      (e): e is { type: "ready" | "error" } =>
        isType("ready")(e) || isType("error")(e),
    );
  }

  logout(): void {
    this.send({ type: "logout" });
  }

  close(): void {
    this.ws.close();
  }

  /** Polls this client's accumulated events for one matching `predicate`,
   * tolerant of other, unrelated events interleaved before it -- the
   * same "search, don't assume position" principle the C++ backend's
   * own Python test suite uses for its recv_matching() helper. */
  async waitFor<T>(predicate: (e: unknown) => e is T, timeoutMs = 3000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.events.find(predicate);
      if (found !== undefined) return found;
      if (Date.now() > deadline) {
        throw new Error(
          `timed out waiting for matching event; saw: ${JSON.stringify(this.events, null, 2)}`,
        );
      }
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  /** Asserts no event matching `predicate` arrives within `windowMs` --
   * used to prove negative routing properties (e.g. a non-member never
   * receives a group message). */
  async assertNever<T>(predicate: (e: unknown) => e is T, windowMs = 400): Promise<void> {
    const deadline = Date.now() + windowMs;
    while (Date.now() < deadline) {
      if (this.events.some(predicate)) {
        throw new Error(`expected no matching event, but found one: ${JSON.stringify(this.events, null, 2)}`);
      }
      await new Promise((r) => setTimeout(r, 20));
    }
  }
}

type ServerEventOf<K extends string> = { type: K } & Record<string, unknown>;
export function isType<K extends string>(type: K) {
  return (e: unknown): e is ServerEventOf<K> =>
    typeof e === "object" && e !== null && (e as Record<string, unknown>)["type"] === type;
}
