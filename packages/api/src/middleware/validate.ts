import type { NextFunction, Request, Response } from "express";
import type { ZodSchema } from "zod";
import { ApiError } from "./error.js";

/** Validate and replace req.body with the parsed result (or 400 with details). */
export function validateBody(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      throw new ApiError(400, "validation_failed", result.error.flatten());
    }
    req.body = result.data;
    next();
  };
}

/** Validate req.query into res.locals.query (Express query is read-only-ish). */
export function validateQuery(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      throw new ApiError(400, "validation_failed", result.error.flatten());
    }
    res.locals.query = result.data;
    next();
  };
}
