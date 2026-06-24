/** Centralised env-driven config. Read once, validated, reused everywhere. */

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) throw new Error(`Env var ${name} must be an integer`);
  return n;
}

export const config = {
  redisUrl: env("REDIS_URL", "redis://localhost:6379"),
  databaseUrl: env(
    "DATABASE_URL",
    "postgres://queueflow:queueflow@127.0.0.1:5440/queueflow",
  ),
  logLevel: env("LOG_LEVEL", "info"),
  workerConcurrency: envInt("WORKER_CONCURRENCY", 4),
  /** Visibility timeout: how long a worker may hold a job before it's reclaimable. */
  leaseMs: envInt("LEASE_MS", 30_000),

  // --- Observability ---
  /** Port the worker exposes its Prometheus /metrics on. */
  workerMetricsPort: envInt("WORKER_METRICS_PORT", 9100),

  // --- API ---
  apiPort: envInt("API_PORT", 4000),
  jwtSecret: env("JWT_SECRET", "dev-insecure-secret-change-me"),
  jwtAccessTtl: env("JWT_ACCESS_TTL", "15m"),
  jwtRefreshTtl: env("JWT_REFRESH_TTL", "7d"),
  /** Per-user token-bucket: sustained requests/min and burst capacity. */
  rateLimitPerMin: envInt("RATE_LIMIT_PER_MIN", 120),
  rateLimitBurst: envInt("RATE_LIMIT_BURST", 40),
} as const;

export type Config = typeof config;
