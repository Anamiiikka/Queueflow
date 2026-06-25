import { Redis } from "ioredis";
import { combineHooks, RedisEventPublisher, Worker } from "@queueflow/core";
import { createPool, PostgresHooks } from "@queueflow/db";
import { MetricsHooks, metrics, startMetricsServer } from "@queueflow/metrics";
import { config, logger, type QueueHooks } from "@queueflow/shared";
import { handlers } from "./handlers.js";

/**
 * Worker entrypoint. Run several of these (or scale the docker-compose replica count)
 * to process the queue in parallel. Each is stateless and self-coordinates via Redis.
 *
 * Observability: every engine transition fans out (via combineHooks) to Prometheus
 * metrics and a Redis pub/sub channel for live updates. Postgres projection is added
 * when the DB is reachable; otherwise the worker still runs on Redis alone.
 */
const QUEUE = "default";
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
  hooks: combineHooks(...sinks),
  logger,
});

for (const [type, handler] of Object.entries(handlers)) {
  worker.register(type, handler);
}

worker.start();

// Expose Prometheus metrics and keep the queue-depth gauge fresh.
startMetricsServer(config.workerMetricsPort);
const depthTimer = setInterval(async () => {
  try {
    const stats = await worker.engine.stats(QUEUE);
    for (const [state, value] of Object.entries(stats)) {
      metrics.queueDepth.set({ queue: QUEUE, state }, value);
    }
  } catch {
    /* transient redis hiccup — next tick will refresh */
  }
}, 2_000);
depthTimer.unref();

logger.info("worker process up", {
  types: Object.keys(handlers),
  metricsPort: config.workerMetricsPort,
});
