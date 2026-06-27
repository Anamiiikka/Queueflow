import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "@queueflow/shared";
import { ApiError } from "./error.js";

export interface AuthedUser {
  id: string;
  role: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

/** Require a valid access token; attach the user to req.user. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new ApiError(401, "missing_token");
  }
  const token = header.slice("Bearer ".length);
  try {
    const payload = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
    if (payload.type !== "access") throw new Error("wrong token type");
    req.user = { id: String(payload.sub), role: String(payload.role ?? "user") };
    next();
  } catch {
    throw new ApiError(401, "invalid_token");
  }
}

/** Require the authenticated user to be an admin. */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (req.user?.role !== "admin") throw new ApiError(403, "forbidden");
  next();
}
