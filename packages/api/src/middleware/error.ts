import type { NextFunction, Request, Response } from "express";
import { logger } from "@queueflow/shared";

/** A typed error carrying an HTTP status. Throw these from routes/services. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (_req: Request, res: Response): void => {
  res.status(404).json({ error: "not_found" });
};

/** Central error handler — keeps route code free of try/catch boilerplate. */
export const errorHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }
  logger.error("unhandled error", { err: err instanceof Error ? err.stack : String(err) });
  res.status(500).json({ error: "internal_error" });
};

/** Wrap an async handler so thrown/rejected errors reach the error handler. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}
