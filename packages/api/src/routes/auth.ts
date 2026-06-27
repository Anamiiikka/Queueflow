import { Router } from "express";
import type { AuthService } from "../services/AuthService.js";
import { asyncHandler } from "../middleware/error.js";
import { validateBody } from "../middleware/validate.js";
import { loginSchema, refreshSchema, registerSchema } from "../schemas.js";

export function authRouter(auth: AuthService): Router {
  const r = Router();

  r.post(
    "/register",
    validateBody(registerSchema),
    asyncHandler(async (req, res) => {
      const result = await auth.register(req.body.email, req.body.password);
      res.status(201).json(result);
    }),
  );

  r.post(
    "/login",
    validateBody(loginSchema),
    asyncHandler(async (req, res) => {
      res.json(await auth.login(req.body.email, req.body.password));
    }),
  );

  r.post(
    "/refresh",
    validateBody(refreshSchema),
    asyncHandler(async (req, res) => {
      res.json(await auth.refresh(req.body.refreshToken));
    }),
  );

  r.post(
    "/logout",
    validateBody(refreshSchema),
    asyncHandler(async (req, res) => {
      await auth.logout(req.body.refreshToken);
      res.status(204).end();
    }),
  );

  return r;
}
