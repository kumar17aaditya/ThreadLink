// One-shot manual smoke test: spawns the real C++ server and the real
// gateway as child processes, connects a couple of WebSocket clients,
// and exercises the basic public-chat path. Not part of the automated
// test suite (see tests/e2e.test.ts for that) -- this is a fast sanity
// check used while developing the gateway.
import { spawn } from "node:child_process";
import { WebSocket } from "ws";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const PORT_BACKEND = 8090;
const PORT_GATEWAY = 8091;

function waitForPort(port, host = "127.0.0.1", timeoutMs = 5000) {
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
        else setTimeout(attempt, 50);
      });
    }
    attempt();
  });
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "threadlink-smoke-"));
  fs.writeFileSync(
    path.join(tmp, "server.conf"),
    `PORT=${PORT_BACKEND}\nMAX_CLIENTS=10\nMAX_MESSAGE_SIZE=8192\nLOG_LEVEL=WARN\n`,
  );

  let backend, gateway, ws1, ws2;
  try {
    backend = spawn(path.join(REPO_ROOT, "server"), [], { cwd: tmp, stdio: ["pipe", "pipe", "pipe"] });
    backend.stdout.on("data", () => {});
    backend.stderr.on("data", (d) => process.stderr.write(`[backend] ${d}`));

    await waitForPort(PORT_BACKEND);
    console.log("backend up");

    gateway = spawn(process.execPath, [path.join(REPO_ROOT, "gateway/dist/src/index.js")], {
      env: {
        ...process.env,
        GATEWAY_PORT: String(PORT_GATEWAY),
        BACKEND_HOST: "127.0.0.1",
        BACKEND_PORT: String(PORT_BACKEND),
        LOG_LEVEL: "debug",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    gateway.stdout.on("data", (d) => process.stdout.write(`[gateway] ${d}`));
    gateway.stderr.on("data", (d) => process.stderr.write(`[gateway] ${d}`));

    await waitForPort(PORT_GATEWAY);
    console.log("gateway up");

    const events = [];
    ws1 = new WebSocket(`ws://127.0.0.1:${PORT_GATEWAY}`);
    await new Promise((r) => ws1.once("open", r));
    ws1.on("message", (d) => events.push(["ws1", JSON.parse(d.toString())]));

    ws2 = new WebSocket(`ws://127.0.0.1:${PORT_GATEWAY}`);
    await new Promise((r) => ws2.once("open", r));
    ws2.on("message", (d) => events.push(["ws2", JSON.parse(d.toString())]));

    await new Promise((r) => setTimeout(r, 300));
    ws1.send(JSON.stringify({ type: "sendMessage", target: { kind: "public" }, text: "hello from ws1" }));
    await new Promise((r) => setTimeout(r, 300));

    const ws2SawMsg = events.some(
      ([who, e]) => who === "ws2" && e.type === "message" && e.message.text === "hello from ws1",
    );
    const ws1ReadyEvents = events.filter(([who, e]) => who === "ws1" && e.type === "ready");
    const ws2ReadyEvents = events.filter(([who, e]) => who === "ws2" && e.type === "ready");

    console.log("ws2 received ws1's public message:", ws2SawMsg);
    console.log("ws1 got ready:", ws1ReadyEvents.length === 1);
    console.log("ws2 got ready:", ws2ReadyEvents.length === 1);

    if (!ws2SawMsg || ws1ReadyEvents.length !== 1 || ws2ReadyEvents.length !== 1) {
      throw new Error("SMOKE TEST FAILED");
    }
    console.log("SMOKE TEST PASSED");
  } finally {
    ws1?.close();
    ws2?.close();
    gateway?.kill("SIGKILL");
    backend?.stdin?.end();
    backend?.kill("SIGKILL");
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
