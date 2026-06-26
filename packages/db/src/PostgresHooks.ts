import type { Job, QueueHooks } from "@queueflow/shared";
import type { Pool } from "pg";

/**
 * Projects engine lifecycle events into Postgres — the durable audit log.
 *
 * Every transition upserts the job row (so the projection self-heals even if it
 * missed an earlier event) and appends an immutable row to job_events. Dead jobs
 * are additionally copied into dead_letter for the admin DLQ view.
 */
export class PostgresHooks implements QueueHooks {
  constructor(private readonly pool: Pool) {}

  async onCreated(job: Job): Promise<void> {
    await this.upsertJob(job);
    await this.event(job.id, "created");
  }

  async onStarted(job: Job): Promise<void> {
    await this.upsertJob(job);
    await this.event(job.id, "started", job.lockedBy, { attempt: job.attempts });
  }

  async onCompleted(job: Job, result: unknown): Promise<void> {
    await this.pool.query(
      `UPDATE jobs SET status='completed', result=$2, updated_at=now() WHERE id=$1`,
      [job.id, result === undefined ? null : JSON.stringify(result)],
    );
    await this.event(job.id, "completed", job.lockedBy);
  }

  async onFailed(job: Job, outcome: "retry" | "dead", error: string): Promise<void> {
    const status = outcome === "dead" ? "dead" : "retrying";
    await this.pool.query(
      `UPDATE jobs SET status=$2, error=$3, attempts=$4, updated_at=now() WHERE id=$1`,
      [job.id, status, error, job.attempts],
    );
    await this.event(job.id, outcome === "dead" ? "dead" : "retry", job.lockedBy, { error });
    if (outcome === "dead") {
      await this.pool.query(
        `INSERT INTO dead_letter (job_id, original_payload, failure_reason, attempts)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (job_id) DO UPDATE SET failure_reason=EXCLUDED.failure_reason, attempts=EXCLUDED.attempts`,
        [job.id, JSON.stringify(job.payload ?? {}), error, job.attempts],
      );
    }
  }

  async onRecovered(_queue: string, jobIds: string[]): Promise<void> {
    if (jobIds.length === 0) return;
    await this.pool.query(
      `UPDATE jobs SET status='pending', updated_at=now() WHERE id = ANY($1::uuid[])`,
      [jobIds],
    );
    const values = jobIds.map((_, i) => `($${i + 1}, 'recovered')`).join(", ");
    await this.pool.query(`INSERT INTO job_events (job_id, event) VALUES ${values}`, jobIds);
  }

  private async upsertJob(job: Job): Promise<void> {
    await this.pool.query(
      `INSERT INTO jobs
         (id, type, queue, status, priority, payload, idempotency_key, attempts,
          max_attempts, available_at, depends_on, created_at, updated_at)
       VALUES
         ($1,$2,$3,$4,$5,$6,$7,$8,$9, to_timestamp($10/1000.0), $11,
          to_timestamp($12/1000.0), to_timestamp($13/1000.0))
       ON CONFLICT (id) DO UPDATE SET
         status=EXCLUDED.status, attempts=EXCLUDED.attempts,
         available_at=EXCLUDED.available_at, updated_at=EXCLUDED.updated_at`,
      [
        job.id,
        job.type,
        job.queue,
        job.status,
        job.priority,
        JSON.stringify(job.payload ?? {}),
        job.idempotencyKey ?? null,
        job.attempts,
        job.maxAttempts,
        job.availableAt,
        job.dependsOn,
        job.createdAt,
        job.updatedAt,
      ],
    );
  }

  private async event(
    jobId: string,
    event: string,
    workerId?: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO job_events (job_id, event, worker_id, metadata) VALUES ($1,$2,$3,$4)`,
      [jobId, event, workerId ?? null, metadata ? JSON.stringify(metadata) : null],
    );
  }
}
