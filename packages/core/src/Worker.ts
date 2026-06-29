import { hostname } from "node:os";
import { Redis } from "ioredis";
import type { Job, JobHandler } from "@queueflow/shared";
import { createLogger, type Logger } from "@queueflow/shared";
import { CoreQueue, type CoreQueueOptions } from "./CoreQueue.js";

export interface WorkerOptions extends CoreQueueOptions {
  /** Worker id; defaults to host:pid. */
  id?: string;
  /** Queue this worker consumes. */
  queue?: string;
  /** Max jobs processed concurrently by this worker. */
  concurrency?: number;
  /** Base poll delay (ms) when the queue is active. */
  pollIntervalMs?: number;
  /** Idle ceiling (ms): the loop backs off toward this when no jobs are found,
   *  drastically cutting Redis traffic on a quiet queue (Upstash-friendly). */
  maxIdleMs?: number;
  /** How often the reaper/promoter housekeeping runs (ms). */
  maintenanceIntervalMs?: number;
  /** Grace period for in-flight jobs to finish on shutdown (ms). */
  drainTimeoutMs?: number;
  logger?: Logger;
}

/**
 * Worker — pulls jobs from a CoreQueue and runs registered handlers concurrently.
 *
 * Responsibilities beyond "claim and run":
 *  - Maintenance loop: promotes due delayed jobs and reaps expired leases so a single
 *    worker is enough to keep the whole system self-healing in dev.
 *  - Graceful shutdown: on SIGTERM/SIGINT it stops claiming, lets in-flight jobs finish
 *    (up to drainTimeoutMs), then exits — so scaling down never loses work.
 */
export class Worker {
  readonly id: string;
  private readonly queue: string;
  private readonly core: CoreQueue;
  private readonly handlers = new Map<string, JobHandler>();
  private readonly concurrency: number;
  private readonly pollIntervalMs: number;
  private readonly maxIdleMs: number;
  private readonly maintenanceIntervalMs: number;
  private readonly drainTimeoutMs: number;
  private readonly log: Logger;

  private running = false;
  private draining = false;
  private active = 0;
  private maintenanceTimer?: NodeJS.Timeout;
  private readonly loops: Promise<void>[] = [];

  constructor(redis: Redis, opts: WorkerOptions = {}) {
    this.id = opts.id ?? `${hostname()}:${process.pid}`;
    this.queue = opts.queue ?? "default";
    this.core = new CoreQueue(redis, opts);
    this.concurrency = opts.concurrency ?? 4;
    this.pollIntervalMs = opts.pollIntervalMs ?? 100;
    this.maxIdleMs = opts.maxIdleMs ?? 2_000;
    this.maintenanceIntervalMs = opts.maintenanceIntervalMs ?? 1_000;
    this.drainTimeoutMs = opts.drainTimeoutMs ?? 15_000;
    this.log = (opts.logger ?? createLogger()).child({ worker: this.id, queue: this.queue });
  }

  /** Register a handler for a job type. Chainable. */
  register<P, R>(type: string, handler: JobHandler<P, R>): this {
    this.handlers.set(type, handler as JobHandler);
    return this;
  }

  /** Start the consume loops + maintenance. Installs signal handlers for graceful exit. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.log.info("worker started", { concurrency: this.concurrency });

    this.maintenanceTimer = setInterval(() => void this.maintenance(), this.maintenanceIntervalMs);
    for (let i = 0; i < this.concurrency; i++) this.loops.push(this.consumeLoop());

    const onSignal = (sig: string) => {
      this.log.info("signal received, draining", { sig });
      void this.shutdown();
    };
    process.once("SIGTERM", () => onSignal("SIGTERM"));
    process.once("SIGINT", () => onSignal("SIGINT"));
  }

  /**
   * One concurrent slot: claim -> run -> ack/nack, repeat until draining.
   * When the queue is empty the poll delay backs off exponentially toward maxIdleMs,
   * so an idle worker issues far fewer Redis calls (important on per-request Redis).
   */
  private async consumeLoop(): Promise<void> {
    let emptyStreak = 0;
    while (this.running && !this.draining) {
      let job: Job | null;
      try {
        job = await this.core.claim(this.queue, this.id);
      } catch (err) {
        this.log.error("claim failed", { err: String(err) });
        await sleep(this.pollIntervalMs);
        continue;
      }
      if (!job) {
        emptyStreak++;
        const backoff = Math.min(this.maxIdleMs, this.pollIntervalMs * 2 ** Math.min(emptyStreak, 6));
        await sleep(backoff);
        continue;
      }
      emptyStreak = 0; // queue is active again — poll fast
      await this.process(job);
    }
  }

  private async process(job: Job): Promise<void> {
    this.active++;
    const handler = this.handlers.get(job.type);
    try {
      if (!handler) throw new Error(`no handler registered for type "${job.type}"`);
      this.log.debug("job started", { id: job.id, type: job.type, attempt: job.attempts });
      const result = await handler(job);
      await this.core.ack(this.queue, job, result);
      this.log.info("job completed", { id: job.id, type: job.type });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const outcome = await this.core.nack(this.queue, job, message);
      this.log.warn("job failed", { id: job.id, type: job.type, outcome, err: message });
    } finally {
      this.active--;
    }
  }

  /** Background housekeeping: keep delayed jobs flowing and recover dead leases. */
  private async maintenance(): Promise<void> {
    try {
      await this.core.promoteDue(this.queue);
      const recovered = await this.core.reapExpired(this.queue);
      if (recovered.length > 0) {
        this.log.warn("recovered expired jobs", { count: recovered.length, ids: recovered });
      }
    } catch (err) {
      this.log.error("maintenance failed", { err: String(err) });
    }
  }

  /** Stop claiming, wait for in-flight jobs (bounded), then resolve. */
  async shutdown(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    if (this.maintenanceTimer) clearInterval(this.maintenanceTimer);

    const deadline = Date.now() + this.drainTimeoutMs;
    while (this.active > 0 && Date.now() < deadline) {
      await sleep(50);
    }
    this.running = false;
    if (this.active > 0) {
      this.log.warn("drain timeout: in-flight jobs will be recovered by reaper", { active: this.active });
    }
    this.log.info("worker stopped");
  }

  /** Expose the engine for tests/scripts that need direct enqueue/stats access. */
  get engine(): CoreQueue {
    return this.core;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
