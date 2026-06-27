import type { NextFunction, Request, Response } from "express";
import { Redis } from "ioredis";
import { ApiError } from "./error.js";

/**
 * Distributed token-bucket rate limiter, evaluated atomically in Redis so it holds
 * across many API instances. Each caller refills at `refillPerSec` up to `capacity`;
 * a request costs one token. Prevents a single user from flooding the queue.
 */
const TOKEN_BUCKET = `
local capacity = tonumber(ARGV[1])
local refill = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])
local data = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])
if tokens == nil then tokens = capacity; ts = now end
local elapsed = math.max(0, now - ts) / 1000.0
tokens = math.min(capacity, tokens + elapsed * refill)
local allowed = 0
if tokens >= cost then allowed = 1; tokens = tokens - cost end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', KEYS[1], math.ceil(capacity / refill * 1000) + 1000)
return {allowed, math.floor(tokens)}
`;

interface BucketRedis extends Redis {
  qf_ratelimit(key: string, ...args: (string | number)[]): Promise<[number, number]>;
}

export interface RateLimitOptions {
  /** Sustained requests per minute (refill rate). */
  perMinute: number;
  /** Max burst (bucket capacity). */
  burst: number;
}

export function rateLimit(redis: Redis, opts: RateLimitOptions) {
  const r = redis as BucketRedis;
  if (typeof r.qf_ratelimit !== "function") {
    r.defineCommand("qf_ratelimit", { numberOfKeys: 1, lua: TOKEN_BUCKET });
  }
  const refillPerSec = opts.perMinute / 60;

  // Forward errors via next() — throwing across an async middleware boundary in
  // Express 4 becomes an unhandled rejection (which crashes the process), not a 500.
  return (req: Request, res: Response, next: NextFunction): void => {
    void (async () => {
      const id = req.user?.id ?? req.ip ?? "anon";
      const [allowed, remaining] = await r.qf_ratelimit(
        `rl:${id}`,
        opts.burst,
        refillPerSec,
        Date.now(),
        1,
      );
      res.setHeader("X-RateLimit-Remaining", String(remaining));
      next(allowed === 0 ? new ApiError(429, "rate_limited") : undefined);
    })().catch(next);
  };
}
