/**
 * Tiny structured logger. Swapped for pino in Phase 5 when we wire OTel trace ids.
 * Kept dependency-free here so the core package stays light.
 */
type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const threshold = (process.env.LOG_LEVEL as Level) ?? "info";

function emit(level: Level, msg: string, meta?: Record<string, unknown>): void {
  if (ORDER[level] < ORDER[threshold]) return;
  const line = {
    level,
    msg,
    time: new Date().toISOString(),
    ...meta,
  };
  const stream = level === "error" || level === "warn" ? process.stderr : process.stdout;
  stream.write(JSON.stringify(line) + "\n");
}

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

export function createLogger(bindings: Record<string, unknown> = {}): Logger {
  const wrap =
    (level: Level) => (msg: string, meta?: Record<string, unknown>) =>
      emit(level, msg, { ...bindings, ...meta });
  return {
    debug: wrap("debug"),
    info: wrap("info"),
    warn: wrap("warn"),
    error: wrap("error"),
    child: (extra) => createLogger({ ...bindings, ...extra }),
  };
}

export const logger = createLogger();
