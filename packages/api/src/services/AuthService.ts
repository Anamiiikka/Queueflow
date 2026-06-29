import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Redis } from "ioredis";
import type { Pool } from "@queueflow/db";
import { config } from "@queueflow/shared";
import { ApiError } from "../middleware/error.js";

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * Auth with hashed passwords (bcrypt) and JWT access/refresh tokens.
 *
 * Access tokens are stateless and short-lived. Refresh tokens carry a jti that is
 * tracked in Redis, so refresh can be rotated and logout can revoke — a stateless
 * access token plus a server-revocable refresh token is the standard pragmatic mix.
 */
export class AuthService {
  constructor(
    private readonly pool: Pool,
    private readonly redis: Redis,
  ) {}

  async register(email: string, password: string): Promise<{ id: string } & Tokens> {
    const hash = await bcrypt.hash(password, 10);
    let id: string;
    try {
      const { rows } = await this.pool.query<{ id: string }>(
        `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id`,
        [email, hash],
      );
      id = rows[0]!.id;
    } catch (err) {
      if (err instanceof Error && "code" in err && (err as { code: string }).code === "23505") {
        throw new ApiError(409, "email_taken");
      }
      throw err;
    }
    return { id, ...(await this.issueTokens(id, "user")) };
  }

  /**
   * Issue a token for a shared demo user without credentials — lets the public
   * dashboard skip the signup step. Auth (JWT, rate limiting) still applies; this
   * just bootstraps a session. Disable with ALLOW_DEMO_AUTH=false.
   */
  async demo(): Promise<{ id: string } & Tokens> {
    const email = "demo@queueflow.local";
    const hash = await bcrypt.hash(randomUUID(), 10);
    const { rows } = await this.pool.query<{ id: string; role: string }>(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'user')
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
       RETURNING id, role`,
      [email, hash],
    );
    const user = rows[0]!;
    return { id: user.id, ...(await this.issueTokens(user.id, user.role)) };
  }

  async login(email: string, password: string): Promise<{ id: string } & Tokens> {
    const { rows } = await this.pool.query<{ id: string; password_hash: string; role: string }>(
      `SELECT id, password_hash, role FROM users WHERE email = $1`,
      [email],
    );
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      throw new ApiError(401, "invalid_credentials");
    }
    return { id: user.id, ...(await this.issueTokens(user.id, user.role)) };
  }

  async refresh(refreshToken: string): Promise<Tokens> {
    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(refreshToken, config.jwtSecret) as jwt.JwtPayload;
    } catch {
      throw new ApiError(401, "invalid_token");
    }
    if (payload.type !== "refresh" || !payload.jti) throw new ApiError(401, "invalid_token");

    // The jti must still be active in Redis (not rotated/revoked).
    const stored = await this.redis.get(`refresh:${payload.jti}`);
    if (stored !== String(payload.sub)) throw new ApiError(401, "expired_session");

    // Rotate: invalidate the old refresh token, issue a fresh pair.
    await this.redis.del(`refresh:${payload.jti}`);
    return this.issueTokens(String(payload.sub), String(payload.role ?? "user"));
  }

  async logout(refreshToken: string): Promise<void> {
    try {
      const payload = jwt.verify(refreshToken, config.jwtSecret) as jwt.JwtPayload;
      if (payload.jti) await this.redis.del(`refresh:${payload.jti}`);
    } catch {
      // Logging out an already-invalid token is a no-op success.
    }
  }

  private async issueTokens(userId: string, role: string): Promise<Tokens> {
    const accessToken = jwt.sign({ type: "access", role }, config.jwtSecret, {
      subject: userId,
      expiresIn: config.jwtAccessTtl as jwt.SignOptions["expiresIn"],
    });
    const jti = randomUUID();
    const refreshToken = jwt.sign({ type: "refresh", role, jti }, config.jwtSecret, {
      subject: userId,
      expiresIn: config.jwtRefreshTtl as jwt.SignOptions["expiresIn"],
    });
    // Track the refresh jti so it can be rotated/revoked. TTL mirrors the token.
    await this.redis.set(`refresh:${jti}`, userId, "EX", sevenDaysSec());
    return { accessToken, refreshToken };
  }
}

function sevenDaysSec(): number {
  return 7 * 24 * 3600;
}
