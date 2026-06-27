import { Router } from "express";
import type { QueueService } from "../services/QueueService.js";
import { ApiError, asyncHandler } from "../middleware/error.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { createJobSchema, listJobsQuerySchema } from "../schemas.js";

export function jobsRouter(queue: QueueService): Router {
  const r = Router();
  // requireAuth is applied at mount time in app.ts (before the rate limiter).

  // Create a job. An Idempotency-Key header dedupes retried submissions.
  r.post(
    "/",
    validateBody(createJobSchema),
    asyncHandler(async (req, res) => {
      const idempotencyKey = headerKey(req.headers["idempotency-key"]);
      const { id, created } = await queue.enqueue({ ...req.body, idempotencyKey });
      res.status(created ? 201 : 200).json({ jobId: id, deduplicated: !created });
    }),
  );

  r.get(
    "/",
    validateQuery(listJobsQuerySchema),
    asyncHandler(async (_req, res) => {
      res.json({ jobs: await queue.listJobs(res.locals.query) });
    }),
  );

  r.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const job = await queue.getJob(req.params.id!);
      if (!job) throw new ApiError(404, "job_not_found");
      res.json(job);
    }),
  );

  r.post(
    "/:id/retry",
    asyncHandler(async (req, res) => {
      const ok = await queue.retry(queueName(req), req.params.id!);
      if (!ok) throw new ApiError(404, "job_not_found");
      res.json({ ok: true });
    }),
  );

  r.post(
    "/:id/cancel",
    asyncHandler(async (req, res) => {
      const ok = await queue.cancel(queueName(req), req.params.id!);
      if (!ok) throw new ApiError(409, "not_cancellable");
      res.json({ ok: true });
    }),
  );

  r.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      await queue.remove(queueName(req), req.params.id!);
      res.status(204).end();
    }),
  );

  return r;
}

/** Allow ?queue=foo to target a non-default queue for admin actions. */
function queueName(req: { query: Record<string, unknown> }): string {
  const q = req.query.queue;
  return typeof q === "string" && q ? q : "default";
}

function headerKey(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v || undefined;
}
