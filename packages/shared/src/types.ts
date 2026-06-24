/**
 * Shared domain types for QueueFlow.
 * These mirror the persisted shape in Postgres and the in-flight shape in Redis.
 */

/** Lifecycle of a job. Stored as a string in both Redis and Postgres. */
export type JobStatus =
  | "pending" // waiting in the queue, ready (or scheduled) to run
  | "processing" // claimed by a worker, lease held
  | "completed" // finished successfully
  | "failed" // an attempt failed; may retry
  | "retrying" // scheduled for a future retry after backoff
  | "dead" // exhausted retries -> dead-letter queue
  | "cancelled"; // cancelled before it ran

/** Lower number = higher priority. 1 is the most urgent. */
export type Priority = 1 | 2 | 3 | 4 | 5;

/** The canonical job record. */
export interface Job<P = unknown> {
  id: string;
  type: string;
  queue: string;
  status: JobStatus;
  priority: Priority;
  payload: P;
  idempotencyKey?: string;
  attempts: number;
  maxAttempts: number;
  /** Epoch ms at which the job becomes claimable (delayed/scheduled jobs). */
  availableAt: number;
  /** Worker id currently holding the lease, if processing. */
  lockedBy?: string;
  /** Epoch ms at which the lease expires (visibility timeout). */
  lockedUntil?: number;
  dependsOn: string[];
  result?: unknown;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

/** What a caller provides to enqueue a job. The engine fills in the rest. */
export interface EnqueueOptions<P = unknown> {
  type: string;
  payload: P;
  queue?: string;
  priority?: Priority;
  maxAttempts?: number;
  /** Relative delay in ms before the job may run. */
  delayMs?: number;
  /** Absolute epoch ms at which the job may run (overrides delayMs). */
  runAt?: number;
  idempotencyKey?: string;
  dependsOn?: string[];
}

/** A handler turns a job's payload into a result (or throws to fail the attempt). */
export type JobHandler<P = unknown, R = unknown> = (
  job: Job<P>,
) => Promise<R> | R;

/** Audit event emitted on every state transition. */
export type JobEvent =
  | "created"
  | "started"
  | "completed"
  | "failed"
  | "retry"
  | "dead"
  | "cancelled"
  | "recovered"; // requeued by the reaper after a lease expired

/**
 * Lifecycle hooks fired by the engine on each state transition. Implementations
 * project these into a durable store (Postgres) and/or a live channel (pub/sub).
 *
 * The engine depends only on this interface — never on a database driver — so the
 * core stays light and the projection target is swappable. Hooks are awaited but
 * their failures are isolated: a projection error must never break the queue.
 */
export interface QueueHooks {
  onCreated?(job: Job): Promise<void> | void;
  onStarted?(job: Job): Promise<void> | void;
  onCompleted?(job: Job, result: unknown): Promise<void> | void;
  onFailed?(job: Job, outcome: "retry" | "dead", error: string): Promise<void> | void;
  onRecovered?(queue: string, jobIds: string[]): Promise<void> | void;
}
