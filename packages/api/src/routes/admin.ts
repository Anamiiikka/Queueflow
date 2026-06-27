import { Router } from "express";
import { Redis } from "ioredis";
import type { QueueService } from "../services/QueueService.js";
import { asyncHandler } from "../middleware/error.js";

/**
 * Operational endpoints for the dashboard. Queue pause/resume is a simple Redis flag
 * the workers consult (wired into the worker loop in a later phase); here we expose
 * the control surface and the inspection views.
 */
export function adminRouter(queue: QueueService, redis: Redis): Router {
  const r = Router();
  // requireAuth is applied at mount time in app.ts (before the rate limiter).

  r.get(
    "/queues/:queue/stats",
    asyncHandler(async (req, res) => {
      res.json(await queue.stats(req.params.queue!));
    }),
  );

  r.post(
    "/queues/:queue/pause",
    asyncHandler(async (req, res) => {
      await redis.set(`q:${req.params.queue!}:paused`, "1");
      res.json({ queue: req.params.queue!, paused: true });
    }),
  );

  r.post(
    "/queues/:queue/resume",
    asyncHandler(async (req, res) => {
      await redis.del(`q:${req.params.queue!}:paused`);
      res.json({ queue: req.params.queue!, paused: false });
    }),
  );

  r.get(
    "/dlq",
    asyncHandler(async (req, res) => {
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      res.json({ deadLetter: await queue.deadLetter(limit) });
    }),
  );

  r.post(
    "/dlq/:id/requeue",
    asyncHandler(async (req, res) => {
      const q = typeof req.query.queue === "string" ? req.query.queue : "default";
      const ok = await queue.retry(q, req.params.id!);
      res.status(ok ? 200 : 404).json({ ok });
    }),
  );

  return r;
}
