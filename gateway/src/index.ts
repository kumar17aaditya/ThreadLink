import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import { GatewayServer } from "./gatewayServer.js";
import { openDatabase } from "./db.js";

const config = loadConfig();
logger.setMinLevel(config.logLevel);

const db = openDatabase(config.dbPath);
const server = new GatewayServer(config, db);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received, shutting down gateway...`);
  try {
    await server.close();
    db.close();
    logger.info("Gateway shut down cleanly.");
    process.exit(0);
  } catch (err) {
    logger.error(`Error during shutdown: ${(err as Error).message}`);
    process.exit(1);
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
