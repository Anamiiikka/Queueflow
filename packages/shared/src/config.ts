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

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw === "1" || raw.toLowerCase() === "true";
}

export const config = {
  nodeEnv: env("NODE_ENV", "development"),
  isProduction: (process.env.NODE_ENV ?? "development") === "production",
  redisUrl: env("REDIS_URL", "redis://localhost:6379"),
  databaseUrl: env(
    "DATABASE_URL",
    "postgres://queueflow:queueflow@127.0.0.1:5440/queueflow",
  ),
  logLevel: env("LOG_LEVEL", "info"),
  workerConcurrency: envInt("WORKER_CONCURRENCY", 4),
  /** Visibility timeout: how long a worker may hold a job before it's reclaimable. */
  leaseMs: envInt("LEASE_MS", 30_000),
  /** Run the worker loop inside the API process — enables a single-service (free) deploy. */
  runWorkerInline: envBool("RUN_WORKER_INLINE", false),

  // --- Worker poll tuning (matters on per-request Redis like Upstash) ---
  /** Fast poll delay when the queue is active. */
  workerPollMs: envInt("WORKER_POLL_MS", 100),
  /** Idle poll ceiling — the loop backs off toward this when no jobs are found. */
  workerMaxIdleMs: envInt("WORKER_MAX_IDLE_MS", 2_000),
  /** Maintenance (reaper/promoter) cadence. */
  workerMaintenanceMs: envInt("WORKER_MAINTENANCE_MS", 1_000),
  /** Queue-depth gauge refresh cadence. */
  workerDepthMs: envInt("WORKER_DEPTH_MS", 2_000),

  // --- Observability ---
  /** Port the worker exposes its Prometheus /metrics on. */
  workerMetricsPort: envInt("WORKER_METRICS_PORT", 9100),

  // --- API ---
  // Render (and most PaaS) inject PORT; fall back to API_PORT then 4000.
  apiPort: envInt("PORT", envInt("API_PORT", 4000)),
  /** Allowed browser origins for CORS (comma-separated). */
  corsOrigins: env("CORS_ORIGINS", "http://localhost:3000").split(","),
  jwtSecret: env("JWT_SECRET", "dev-insecure-secret-change-me"),
  jwtAccessTtl: env("JWT_ACCESS_TTL", "15m"),
  jwtRefreshTtl: env("JWT_REFRESH_TTL", "7d"),
  /** Per-user token-bucket: sustained requests/min and burst capacity. */
  rateLimitPerMin: envInt("RATE_LIMIT_PER_MIN", 120),
  rateLimitBurst: envInt("RATE_LIMIT_BURST", 40),
  /** Issue a frictionless demo token via POST /auth/demo (no signup). */
  allowDemoAuth: envBool("ALLOW_DEMO_AUTH", true),
} as const;

export type Config = typeof config;
