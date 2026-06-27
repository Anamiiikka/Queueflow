import { z } from "zod";

/** Request validation schemas. Parsed by the `validate` middleware. */

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
});

export const loginSchema = registerSchema;

export const refreshSchema = z.object({
  refreshToken: z.string().min(10),
});

export const createJobSchema = z.object({
  type: z.string().min(1).max(64),
  payload: z.record(z.unknown()).default({}),
  queue: z.string().min(1).max(64).optional(),
  priority: z.number().int().min(1).max(5).optional(),
  maxAttempts: z.number().int().min(1).max(50).optional(),
  delayMs: z.number().int().min(0).max(7 * 24 * 3600_000).optional(),
  runAt: z.number().int().positive().optional(),
  dependsOn: z.array(z.string().uuid()).optional(),
});

export const listJobsQuerySchema = z.object({
  status: z.string().optional(),
  type: z.string().optional(),
  queue: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export type CreateJobInput = z.infer<typeof createJobSchema>;
