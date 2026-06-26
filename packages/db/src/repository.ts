import type { Pool } from "pg";

/** Read-side queries that back the dashboard and admin API (Phase 3+). */
export class JobRepository {
  constructor(private readonly pool: Pool) {}

  /** Paginated job list with optional filters. */
  async listJobs(filter: {
    status?: string;
    type?: string;
    queue?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<unknown[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    for (const [col, val] of [
      ["status", filter.status],
      ["type", filter.type],
      ["queue", filter.queue],
    ] as const) {
      if (val) {
        params.push(val);
        where.push(`${col} = $${params.length}`);
      }
    }
    params.push(Math.min(filter.limit ?? 50, 200));
    const limitIdx = params.length;
    params.push(filter.offset ?? 0);
    const offsetIdx = params.length;
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const { rows } = await this.pool.query(
      `SELECT * FROM jobs ${clause} ORDER BY created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );
    return rows;
  }

  /** A job plus its full event timeline. */
  async getJobWithEvents(id: string): Promise<{ job: unknown; events: unknown[] } | null> {
    const job = await this.pool.query(`SELECT * FROM jobs WHERE id = $1`, [id]);
    if (job.rowCount === 0) return null;
    const events = await this.pool.query(
      `SELECT event, worker_id, metadata, created_at FROM job_events WHERE job_id = $1 ORDER BY created_at`,
      [id],
    );
    return { job: job.rows[0], events: events.rows };
  }

  /** Counts per status for the dashboard overview. */
  async statusCounts(queue?: string): Promise<Record<string, number>> {
    const { rows } = await this.pool.query<{ status: string; count: string }>(
      queue
        ? `SELECT status, COUNT(*)::text AS count FROM jobs WHERE queue=$1 GROUP BY status`
        : `SELECT status, COUNT(*)::text AS count FROM jobs GROUP BY status`,
      queue ? [queue] : [],
    );
    return Object.fromEntries(rows.map((r) => [r.status, Number(r.count)]));
  }

  async deadLetter(limit = 100): Promise<unknown[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM dead_letter ORDER BY failed_at DESC LIMIT $1`,
      [Math.min(limit, 200)],
    );
    return rows;
  }

  /** Update a job's status and append a matching audit event (admin actions). */
  async setStatus(id: string, status: string, event: string): Promise<void> {
    await this.pool.query(`UPDATE jobs SET status=$2, updated_at=now() WHERE id=$1`, [id, status]);
    await this.pool.query(`INSERT INTO job_events (job_id, event) VALUES ($1, $2)`, [id, event]);
  }

  /** Remove a job (events cascade) and drop it from the DLQ table. */
  async removeJob(id: string): Promise<void> {
    await this.pool.query(`DELETE FROM dead_letter WHERE job_id=$1`, [id]);
    await this.pool.query(`DELETE FROM jobs WHERE id=$1`, [id]);
  }

  /** Clear a requeued job out of the DLQ table. */
  async clearDeadLetter(id: string): Promise<void> {
    await this.pool.query(`DELETE FROM dead_letter WHERE job_id=$1`, [id]);
  }
}
