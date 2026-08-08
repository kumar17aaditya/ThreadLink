/** Leveled, timestamped console logger. Output format intentionally
 * mirrors the C++ backend's Log.h ("[timestamp] [LEVEL] message") so
 * gateway and backend logs read consistently side by side. */

type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

class Logger {
  private minLevel: Level = "info";

  setMinLevel(level: Level): void {
    this.minLevel = level;
  }

  private write(level: Level, msg: string): void {
    if (ORDER[level] < ORDER[this.minLevel]) return;
    const ts = new Date().toISOString().replace("T", " ").replace("Z", "");
    const line = `[${ts}] [${level.toUpperCase()}] ${msg}`;
    if (level === "warn" || level === "error") console.error(line);
    else console.log(line);
  }

  debug(msg: string): void {
    this.write("debug", msg);
  }
  info(msg: string): void {
    this.write("info", msg);
  }
  warn(msg: string): void {
    this.write("warn", msg);
  }
  error(msg: string): void {
    this.write("error", msg);
  }
}

export const logger = new Logger();
