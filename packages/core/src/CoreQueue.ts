import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import type { EnqueueOptions, Job, JobStatus, Priority, QueueHooks } from "@queueflow/shared";
import { createLogger, type Logger } from "@queueflow/shared";
import { ACK, CLAIM, ENQUEUE, NACK, PRIORITY_BUCKET, PROMOTE, REAPER } from "./lua.js";
import { computeBackoff, type BackoffOptions } from "./backoff.js";
import { JOB_PREFIX, keys } from "./keys.js";

/** ioredis with our custom commands attached via defineCommand. */
interface ScriptedRedis extends Redis {
  qf_enqueue(...args: (string | number)[]): Promise<[string, number]>;
  qf_claim(...args: (string | number)[]): Promise<string[] | null>;
  qf_ack(...args: (string | number)[]): Promise<number>;
  qf_nack(...args: (string | number)[]): Promise<"retry" | "dead">;
  qf_reaper(...args: (string | number)[]): Promise<string[]>;
  qf_promote(...args: (string | number)[]): Promise<number>;
}

export interface CoreQueueOptions {
  /** Visibility timeout: how long a worker may hold a job before it's reclaimable. */
  leaseMs?: number;
  /** Backoff tuning for retries. */
  backoff?: BackoffOptions;
  /** TTL for idempotency keys, seconds. Default 24h. */
  idempotencyTtlSec?: number;
  /** Injected clock — overridable in tests for determinism. */
  now?: () => number;
  /** Injected RNG — overridable in tests so backoff jitter is reproducible. */
  random?: () => number;
  /** Projection hooks (durable audit log, live updates). Failures are isolated. */
  hooks?: QueueHooks;
  /** Logger for isolated hook errors. */
  logger?: Logger;
}

/**
 * CoreQueue — a small, correct distributed queue built directly on Redis.
 *
 * Every mutating operation delegates to an atomic Lua script (see lua.ts), so the
 * queue is safe under any number of concurrent workers and survives worker crashes
 * via the lease/reaper mechanism. Postgres mirroring + metrics are layered on top
 * by the API/worker packages; this class is the pure engine.
 */
export class CoreQueue {
  private readonly redis: ScriptedRedis;
  private readonly leaseMs: number;
  private readonly backoff: BackoffOptions;
  private readonly idemTtl: number;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly hooks: QueueHooks;
  private readonly log: Logger;

  constructor(redis: Redis, opts: CoreQueueOptions = {}) {
    this.redis = redis as ScriptedRedis;
    this.leaseMs = opts.leaseMs ?? 30_000;
    this.backoff = opts.backoff ?? {};
    this.idemTtl = opts.idempotencyTtlSec ?? 86_400;
    this.now = opts.now ?? (() => Date.now());
    this.random = opts.random ?? Math.random;
    this.hooks = opts.hooks ?? {};
    this.log = opts.logger ?? createLogger({ component: "CoreQueue" });
    this.defineCommands();
  }

  /**
   * Run a projection hook without ever letting its failure break the queue.
   * `invoke` calls the method on the hooks object itself so `this` is preserved
   * (the hooks may be a class instance whose methods reference instance state).
   */
  private async fire(
    name: keyof QueueHooks,
    invoke: (hooks: QueueHooks) => Promise<void> | void,
  ): Promise<void> {
    if (!this.hooks[name]) return;
    try {
      await invoke(this.hooks);
    } catch (err) {
      this.log.error("projection hook failed", { hook: String(name), err: String(err) });
    }
  }

  private defineCommands(): void {
    const defs: Array<[string, number, string]> = [
      ["qf_enqueue", 4, ENQUEUE],
      ["qf_claim", 2, CLAIM],
      ["qf_ack", 2, ACK],
      ["qf_nack", 4, NACK],
      ["qf_reaper", 3, REAPER],
      ["qf_promote", 2, PROMOTE],
    ];
    for (const [name, numberOfKeys, lua] of defs) {
      // defineCommand is idempotent per connection; guard so re-instantiation is cheap.
      if (typeof (this.redis as unknown as Record<string, unknown>)[name] !== "function") {
        this.redis.defineCommand(name, { numberOfKeys, lua });
      }
    }
  }

  /** Score that encodes priority (dominant) + availability time (FIFO tiebreak). */
  private pendingScore(priority: Priority, availableAt: number): number {
    return priority * PRIORITY_BUCKET + availableAt;
  }

  /**
   * Enqueue a job. Returns the job id and whether it was newly created
   * (false => an idempotency-key duplicate returned the existing job).
   */
  async enqueue<P>(opts: EnqueueOptions<P>): Promise<{ id: string; created: boolean }> {
    const now = this.now();
    const id = randomUUID();
    const queue = opts.queue ?? "default";
    const priority = (opts.priority ?? 5) as Priority;
    const availableAt = opts.runAt ?? now + (opts.delayMs ?? 0);
    const ready = availableAt <= now;

    const job: Job<P> = {
      id,
      type: opts.type,
      queue,
      status: ready ? "pending" : "retrying",
      priority,
      payload: opts.payload,
      idempotencyKey: opts.idempotencyKey,
      attempts: 0,
      maxAttempts: opts.maxAttempts ?? 5,
      availableAt,
      dependsOn: opts.dependsOn ?? [],
      createdAt: now,
      updatedAt: now,
    };

    const hashFields = this.serialize(job);
    const hasIdem = opts.idempotencyKey ? "1" : "0";

    const [resultId, createdFlag] = await this.redis.qf_enqueue(
      keys.pending(queue),
      keys.delayed(queue),
      keys.job(id),
      opts.idempotencyKey ? keys.idem(opts.idempotencyKey) : "qf:noidem",
      id,
      ready ? "1" : "0",
      String(this.pendingScore(priority, availableAt)),
      String(availableAt),
      hasIdem,
      String(this.idemTtl),
      ...hashFields,
    );
    const created = createdFlag === 1;
    if (created) await this.fire("onCreated", (h) => h.onCreated!(job));
    return { id: resultId, created };
  }

  /**
   * Inject jobs directly into the "processing" state held by a phantom worker with a
   * short lease — i.e. exactly the state a crashed worker leaves behind. Deterministic
   * (no race with live workers) for the chaos demo; the reaper then recovers them.
   */
  async injectStuck(queue: string, count: number, leaseMs: number): Promise<string[]> {
    const now = this.now();
    const lockedUntil = now + leaseMs;
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const id = randomUUID();
      const job: Job = {
        id,
        type: "ai",
        queue,
        status: "processing",
        priority: 2,
        payload: { chaos: true },
        attempts: 1,
        maxAttempts: 5,
        availableAt: now,
        lockedBy: "phantom-worker-💥",
        lockedUntil,
        dependsOn: [],
        createdAt: now,
        updatedAt: now,
      };
      await this.redis.hset(keys.job(id), ...this.serialize(job));
      await this.redis.hset(keys.job(id), "lockedBy", job.lockedBy!, "lockedUntil", String(lockedUntil));
      await this.redis.zadd(keys.processing(queue), lockedUntil, id);
      await this.fire("onCreated", (h) => h.onCreated!(job));
      await this.fire("onStarted", (h) => h.onStarted!(job));
      ids.push(id);
    }
    return ids;
  }

  /**
   * Atomically claim the next ready job for a worker. Returns null if queue is empty.
   * `leaseMs` overrides the default visibility timeout (used by the chaos demo to make
   * an abandoned lease expire quickly).
   */
  async claim(queue: string, workerId: string, leaseMs = this.leaseMs): Promise<Job | null> {
    const flat = await this.redis.qf_claim(
      keys.pending(queue),
      keys.processing(queue),
      String(this.now()),
      String(leaseMs),
      workerId,
      JOB_PREFIX,
    );
    if (!flat || flat.length === 0) return null;
    const job = this.deserialize(flat);
    await this.fire("onStarted", (h) => h.onStarted!(job));
    return job;
  }

  /** Mark a claimed job complete. Takes the job so projections get full context. */
  async ack(queue: string, job: Job, result: unknown): Promise<void> {
    await this.redis.qf_ack(
      keys.processing(queue),
      keys.job(job.id),
      job.id,
      String(this.now()),
      JSON.stringify(result ?? null),
    );
    await this.fire("onCompleted", (h) => h.onCompleted!(job, result));
  }

  /**
   * Report a failed attempt. The engine decides retry-vs-dead from attempt count;
   * on retry it schedules the next run with exponential backoff + jitter.
   * Returns the outcome so the caller can emit the right audit event.
   */
  async nack(queue: string, job: Job, error: string): Promise<"retry" | "dead"> {
    const retryDelay = computeBackoff(job.attempts, this.random, this.backoff);
    const retryAt = this.now() + retryDelay;
    const outcome = await this.redis.qf_nack(
      keys.processing(queue),
      keys.delayed(queue),
      keys.dlq(queue),
      keys.job(job.id),
      job.id,
      String(this.now()),
      String(retryAt),
      error,
    );
    await this.fire("onFailed", (h) => h.onFailed!(job, outcome, error));
    return outcome;
  }

  /** Requeue jobs whose lease expired (crashed/stalled workers). Returns recovered ids. */
  async reapExpired(queue: string, limit = 100): Promise<string[]> {
    const recovered = await this.redis.qf_reaper(
      keys.processing(queue),
      keys.pending(queue),
      keys.dlq(queue),
      String(this.now()),
      String(limit),
      JOB_PREFIX,
    );
    if (recovered.length > 0) await this.fire("onRecovered", (h) => h.onRecovered!(queue, recovered));
    return recovered;
  }

  /** Promote due delayed/scheduled/retrying jobs into pending. Returns count moved. */
  async promoteDue(queue: string, limit = 200): Promise<number> {
    return this.redis.qf_promote(
      keys.delayed(queue),
      keys.pending(queue),
      String(this.now()),
      String(limit),
      JOB_PREFIX,
    );
  }

  /**
   * Cancel a not-yet-running job: remove it from pending/delayed and mark cancelled.
   * A job already being processed cannot be pulled back — it finishes its attempt.
   * Returns true if it was removed from a waiting state.
   */
  async cancel(queue: string, id: string): Promise<boolean> {
    const removed = await this.redis
      .multi()
      .zrem(keys.pending(queue), id)
      .zrem(keys.delayed(queue), id)
      .exec();
    const tookOut = (removed ?? []).some(([, n]) => Number(n) > 0);
    if (tookOut) {
      await this.redis.hset(keys.job(id), "status", "cancelled", "updatedAt", String(this.now()));
    }
    return tookOut;
  }

  /**
   * Requeue a dead/failed job back to pending with a fresh attempt budget — the admin
   * "retry from DLQ" action. Returns false if the job no longer exists.
   */
  async requeue(queue: string, id: string): Promise<boolean> {
    const job = await this.getJob(id);
    if (!job) return false;
    const now = this.now();
    await this.redis
      .multi()
      .lrem(keys.dlq(queue), 0, id)
      .zrem(keys.delayed(queue), id)
      .hset(keys.job(id), "status", "pending", "attempts", "0", "availableAt", String(now), "updatedAt", String(now))
      .hdel(keys.job(id), "error", "lockedBy", "lockedUntil")
      .zadd(keys.pending(queue), this.pendingScore(job.priority, now), id)
      .exec();
    return true;
  }

  /** Hard-delete a job from every structure. Returns true if the job hash existed. */
  async remove(queue: string, id: string): Promise<boolean> {
    const res = await this.redis
      .multi()
      .zrem(keys.pending(queue), id)
      .zrem(keys.delayed(queue), id)
      .zrem(keys.processing(queue), id)
      .lrem(keys.dlq(queue), 0, id)
      .del(keys.job(id))
      .exec();
    const delCount = res ? Number(res[res.length - 1]?.[1] ?? 0) : 0;
    return delCount > 0;
  }

  /** Fetch a single job by id (or null). */
  async getJob(id: string): Promise<Job | null> {
    const flat = await this.redis.hgetall(keys.job(id));
    const entries = Object.entries(flat);
    if (entries.length === 0) return null;
    return this.deserialize(entries.flat());
  }

  /** Live counts per state for a queue — feeds the dashboard overview. */
  async stats(queue: string): Promise<Record<string, number>> {
    const [pending, delayed, processing, dlq] = await Promise.all([
      this.redis.zcard(keys.pending(queue)),
      this.redis.zcard(keys.delayed(queue)),
      this.redis.zcard(keys.processing(queue)),
      this.redis.llen(keys.dlq(queue)),
    ]);
    return { pending, delayed, processing, dlq };
  }

  // --- (de)serialization between the Job object and the Redis hash ---

  private serialize(job: Job): string[] {
    const f: Record<string, string> = {
      id: job.id,
      type: job.type,
      queue: job.queue,
      status: job.status,
      priority: String(job.priority),
      payload: JSON.stringify(job.payload ?? null),
      attempts: String(job.attempts),
      maxAttempts: String(job.maxAttempts),
      availableAt: String(job.availableAt),
      dependsOn: JSON.stringify(job.dependsOn),
      createdAt: String(job.createdAt),
      updatedAt: String(job.updatedAt),
    };
    if (job.idempotencyKey) f.idempotencyKey = job.idempotencyKey;
    return Object.entries(f).flat();
  }

  private deserialize(flat: string[]): Job {
    const h: Record<string, string> = {};
    for (let i = 0; i < flat.length; i += 2) {
      const k = flat[i];
      const v = flat[i + 1];
      if (k !== undefined && v !== undefined) h[k] = v;
    }
    const job: Job = {
      id: h.id!,
      type: h.type!,
      queue: h.queue ?? "default",
      status: (h.status as JobStatus) ?? "pending",
      priority: Number(h.priority ?? 5) as Priority,
      payload: h.payload ? JSON.parse(h.payload) : null,
      attempts: Number(h.attempts ?? 0),
      maxAttempts: Number(h.maxAttempts ?? 5),
      availableAt: Number(h.availableAt ?? 0),
      dependsOn: h.dependsOn ? JSON.parse(h.dependsOn) : [],
      createdAt: Number(h.createdAt ?? 0),
      updatedAt: Number(h.updatedAt ?? 0),
    };
    if (h.idempotencyKey) job.idempotencyKey = h.idempotencyKey;
    if (h.lockedBy) job.lockedBy = h.lockedBy;
    if (h.lockedUntil) job.lockedUntil = Number(h.lockedUntil);
    if (h.result) job.result = JSON.parse(h.result);
    if (h.error) job.error = h.error;
    return job;
  }
}
