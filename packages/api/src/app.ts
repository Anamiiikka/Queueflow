import express, { type Express } from "express";
import cors from "cors";
import { Redis } from "ioredis";
import type { Pool } from "@queueflow/db";
import { contentType, renderMetrics } from "@queueflow/metrics";
import { config } from "@queueflow/shared";
import { AuthService } from "./services/AuthService.js";
import { QueueService } from "./services/QueueService.js";
import { authRouter } from "./routes/auth.js";
import { jobsRouter } from "./routes/jobs.js";
import { adminRouter } from "./routes/admin.js";
import { errorHandler, notFound } from "./middleware/error.js";
import { rateLimit } from "./middleware/rateLimit.js";
import { requireAuth } from "./middleware/auth.js";

/** Build the Express app. Dependencies are injected so it's testable in isolation. */
export function createApp(redis: Redis, pool: Pool): Express {
  const app = express();
  app.set("trust proxy", true);
  // Allow the dashboard origin(s) to call the API from the browser.
  app.use(
    cors({
      origin: config.corsOrigins,
      exposedHeaders: ["X-RateLimit-Remaining"],
    }),
  );
  app.use(express.json({ limit: "256kb" }));

  const auth = new AuthService(pool, redis);
  const queue = new QueueService(redis, pool);
  const limiter = rateLimit(redis, {
    perMinute: config.rateLimitPerMin,
    burst: config.rateLimitBurst,
  });

  app.get("/health", async (_req, res) => {
    try {
      await Promise.all([redis.ping(), pool.query("SELECT 1")]);
      res.json({ status: "ok" });
    } catch {
      res.status(503).json({ status: "degraded" });
    }
  });

  // Prometheus scrape endpoint (unauthenticated, standard convention).
  app.get("/metrics", async (_req, res) => {
    res.setHeader("content-type", contentType);
    res.end(await renderMetrics());
  });

  // Auth is rate-limited by IP (no user yet). Job/admin require a valid token first,
  // so the limiter (which runs after) keys the bucket by authenticated user.
  app.use("/auth", limiter, authRouter(auth));
  app.use("/jobs", requireAuth, limiter, jobsRouter(queue));
  app.use("/admin", requireAuth, limiter, adminRouter(queue, redis));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
