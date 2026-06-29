import { Redis } from "ioredis";
import { createPool } from "@queueflow/db";
import { config, logger } from "@queueflow/shared";
import { createApp } from "./app.js";
import { attachWebSocket } from "./ws.js";

// Last-resort guard: log unexpected async failures instead of crashing the server.
process.on("unhandledRejection", (reason) => {
  logger.error("unhandledRejection", { reason: String(reason) });
});

const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
const pool = createPool(config.databaseUrl);

const app = createApp(redis, pool);
const server = app.listen(config.apiPort, () => {
  logger.info("api listening", { port: config.apiPort });
});

// Live job-update gateway over WebSocket (ws://host:PORT/ws).
const ws = attachWebSocket(server, redis);

// Single-service deploys can run the worker loop inside this process. It shares the
// same metrics registry, so its metrics appear on this API's /metrics (no extra port).
if (config.runWorkerInline) {
  const { startWorker } = await import("@queueflow/worker");
  await startWorker({ serveMetrics: false });
  logger.info("worker running inline (RUN_WORKER_INLINE=true)");
}

// Graceful shutdown so in-flight requests finish before exit.
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.once(sig, () => {
    logger.info("api shutting down", { sig });
    server.close(async () => {
      await ws.close();
      await Promise.allSettled([redis.quit(), pool.end()]);
      process.exit(0);
    });
  });
}
