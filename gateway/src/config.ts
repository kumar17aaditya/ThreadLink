/**
 * Gateway configuration, loaded from environment variables with
 * validated, safe defaults — mirroring the validation approach used by
 * the C++ server's Config.cpp (invalid values warn and fall back
 * rather than crash the process).
 */
import { logger } from "./logger.js";

export interface GatewayConfig {
  gatewayPort: number;
  backendHost: string;
  backendPort: number;
  /** Cap on a single WS message's JSON payload, in bytes. */
  maxClientMessageBytes: number;
  /** Must not exceed the backend's own MAX_MESSAGE_SIZE (server.conf). */
  backendMaxMessageBytes: number;
  logLevel: "debug" | "info" | "warn" | "error";
}

const DEFAULTS: GatewayConfig = {
  gatewayPort: 8081,
  backendHost: "127.0.0.1",
  backendPort: 8080,
  maxClientMessageBytes: 16 * 1024,
  backendMaxMessageBytes: 8192,
  logLevel: "info",
};

function intFromEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < min || value > max) {
    logger.warn(`config: invalid ${name}='${raw}', keeping default ${fallback}`);
    return fallback;
  }
  return value;
}

function logLevelFromEnv(fallback: GatewayConfig["logLevel"]): GatewayConfig["logLevel"] {
  const raw = (process.env.LOG_LEVEL ?? "").toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") return raw;
  if (raw !== "") {
    logger.warn(`config: unknown LOG_LEVEL='${raw}', keeping default ${fallback}`);
  }
  return fallback;
}

export function loadConfig(): GatewayConfig {
  return {
    gatewayPort: intFromEnv("GATEWAY_PORT", DEFAULTS.gatewayPort, 1, 65535),
    backendHost: process.env.BACKEND_HOST?.trim() || DEFAULTS.backendHost,
    backendPort: intFromEnv("BACKEND_PORT", DEFAULTS.backendPort, 1, 65535),
    maxClientMessageBytes: intFromEnv(
      "MAX_CLIENT_MESSAGE_BYTES",
      DEFAULTS.maxClientMessageBytes,
      64,
      1024 * 1024,
    ),
    backendMaxMessageBytes: intFromEnv(
      "BACKEND_MAX_MESSAGE_BYTES",
      DEFAULTS.backendMaxMessageBytes,
      64,
      16 * 1024 * 1024,
    ),
    logLevel: logLevelFromEnv(DEFAULTS.logLevel),
  };
}
