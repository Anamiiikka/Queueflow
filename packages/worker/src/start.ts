import { Redis } from "ioredis";
import { combineHooks, RedisEventPublisher, Worker } from "@queueflow/core";
import { createPool, PostgresHooks } from "@queueflow/db";
import { MetricsHooks, metrics, startMetricsServer } from "@queueflow/metrics";
import { config, logger, type QueueHooks } from "@queueflow/shared";
import { handlers } from "./handlers.js";

const QUEUE = "default";

export interface StartWorkerOptions {
  /** Bind the standalone /metrics HTTP server (off when embedded in the API). */
  serveMetrics?: boolean;
}

/**
 * Build and start a worker: registers handlers, fans events out to Postgres +
 * Prometheus + pub/sub, and keeps the queue-depth gauge fresh. Used both by the
 * standalone worker process and (inline) by the API for single-service deploys.
 */
export async function startWorker(opts: StartWorkerOptions = {}): Promise<Worker> {
  const serveMetrics = opts.serveMetrics ?? true;
  const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });

  const sinks: QueueHooks[] = [new MetricsHooks(), new RedisEventPublisher(redis)];
  const pool = createPool(config.databaseUrl);
  try {
    await pool.query("SELECT 1");
    sinks.unshift(new PostgresHooks(pool));
    logger.info("postgres projection enabled");
  } catch (err) {
    await pool.end().catch(() => {});
    logger.warn("postgres unreachable — running without durable audit log", { err: String(err) });
  }

  const worker = new Worker(redis, {
    queue: QUEUE,
    concurrency: config.workerConcurrency,
    leaseMs: config.leaseMs,
    pollIntervalMs: config.workerPollMs,
    maxIdleMs: config.workerMaxIdleMs,
    maintenanceIntervalMs: config.workerMaintenanceMs,
    hooks: combineHooks(...sinks),
    logger,
  });
  for (const [type, handler] of Object.entries(handlers)) worker.register(type, handler);
  worker.start();

  if (serveMetrics) startMetricsServer(config.workerMetricsPort);
  const depthTimer = setInterval(async () => {
    try {
      const stats = await worker.engine.stats(QUEUE);
      for (const [state, value] of Object.entries(stats)) {
        metrics.queueDepth.set({ queue: QUEUE, state }, value);
      }
    } catch {
      /* transient redis hiccup — next tick refreshes */
    }
  }, config.workerDepthMs);
  depthTimer.unref();

  logger.info("worker started", {
    types: Object.keys(handlers),
    inline: !serveMetrics,
  });
  return worker;
}
