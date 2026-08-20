type Level = "debug" | "info" | "warn" | "error";

const order: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const threshold: Level = process.env.NODE_ENV === "production" ? "info" : "debug";

/**
 * Minimal structured logger. Emits one JSON object per line in production so
 * log aggregators can parse it, and something readable in development.
 */
function emit(level: Level, message: string, context?: Record<string, unknown>) {
  if (order[level] < order[threshold]) return;

  if (process.env.NODE_ENV === "production") {
    console[level === "debug" ? "log" : level](
      JSON.stringify({ level, message, ...context, time: new Date().toISOString() }),
    );
    return;
  }

  const suffix = context ? ` ${JSON.stringify(context)}` : "";
  console[level === "debug" ? "log" : level](`[${level}] ${message}${suffix}`);
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) =>
    emit("debug", message, context),
  info: (message: string, context?: Record<string, unknown>) =>
    emit("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) =>
    emit("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) =>
    emit("error", message, context),
};
