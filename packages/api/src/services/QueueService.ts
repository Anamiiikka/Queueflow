import { Redis } from "ioredis";
import { CoreQueue, combineHooks, RedisEventPublisher } from "@queueflow/core";
import { JobRepository, PostgresHooks, type Pool } from "@queueflow/db";
import { MetricsHooks } from "@queueflow/metrics";
import { config, logger, type EnqueueOptions } from "@queueflow/shared";

/**
 * Facade the HTTP layer talks to. Owns one CoreQueue (configured with the Postgres
 * projector so enqueues also land in the durable audit log) plus the read repository.
 * Admin mutations update Redis (operational truth) and Postgres (audit) together.
 */
export class QueueService {
  readonly core: CoreQueue;
  private readonly repo: JobRepository;

  constructor(
    redis: Redis,
    private readonly pool: Pool,
  ) {
    // API enqueues fan out to the durable log, Prometheus, and the live event channel.
    this.core = new CoreQueue(redis, {
      hooks: combineHooks(
        new PostgresHooks(pool),
        new MetricsHooks(),
        new RedisEventPublisher(redis),
      ),
      leaseMs: config.leaseMs,
      logger,
    });
    this.repo = new JobRepository(pool);
  }

  enqueue(opts: EnqueueOptions): Promise<{ id: string; created: boolean }> {
    return this.core.enqueue(opts);
  }

  /** Prefer the durable record (with full timeline); fall back to live Redis. */
  async getJob(id: string): Promise<unknown> {
    const fromDb = await this.repo.getJobWithEvents(id);
    if (fromDb) return fromDb;
    const live = await this.core.getJob(id);
    return live ? { job: live, events: [] } : null;
  }

  listJobs(filter: Parameters<JobRepository["listJobs"]>[0]): Promise<unknown[]> {
    return this.repo.listJobs(filter);
  }

  /**
   * Simulate a worker crash for the interactive demo: enqueue a few jobs, then claim
   * them as a phantom worker with a SHORT lease and abandon them (never ack). The real
   * worker's reaper then recovers and completes them — genuine fault tolerance, on demand.
   */
  async simulateCrash(queue: string, n: number): Promise<{ abandoned: number }> {
    const count = Math.max(1, Math.min(n, 8));
    const ids = await this.core.injectStuck(queue, count, 4_000);
    return { abandoned: ids.length };
  }

  /** Combined live (Redis) + durable (Postgres) view for the dashboard. */
  async stats(queue: string): Promise<{ live: Record<string, number>; totals: Record<string, number> }> {
    const [live, totals] = await Promise.all([
      this.core.stats(queue),
      this.repo.statusCounts(queue),
    ]);
    return { live, totals };
  }

  async cancel(queue: string, id: string): Promise<boolean> {
    const ok = await this.core.cancel(queue, id);
    if (ok) await this.repo.setStatus(id, "cancelled", "cancelled");
    return ok;
  }

  async retry(queue: string, id: string): Promise<boolean> {
    const ok = await this.core.requeue(queue, id);
    if (ok) {
      await this.repo.setStatus(id, "pending", "retry");
      await this.repo.clearDeadLetter(id);
    }
    return ok;
  }

  async remove(queue: string, id: string): Promise<boolean> {
    const ok = await this.core.remove(queue, id);
    await this.repo.removeJob(id);
    return ok;
  }

  deadLetter(limit?: number): Promise<unknown[]> {
    return this.repo.deadLetter(limit);
  }
}
