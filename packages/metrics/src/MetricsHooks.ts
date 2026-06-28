import type { Job, QueueHooks } from "@queueflow/shared";
import { metrics } from "./registry.js";

/**
 * Projects engine lifecycle events into Prometheus counters/histograms.
 * Plugged in alongside the Postgres and pub/sub hooks via combineHooks().
 */
export class MetricsHooks implements QueueHooks {
  constructor(private readonly now: () => number = () => Date.now()) {}

  onCreated(job: Job): void {
    metrics.enqueued.inc({ queue: job.queue, type: job.type });
  }

  onCompleted(job: Job): void {
    metrics.completed.inc({ queue: job.queue, type: job.type });
    this.observeDuration(job);
  }

  onFailed(job: Job, outcome: "retry" | "dead"): void {
    metrics.failed.inc({ queue: job.queue, type: job.type, outcome });
    this.observeDuration(job);
  }

  onRecovered(queue: string, jobIds: string[]): void {
    metrics.recovered.inc({ queue }, jobIds.length);
  }

  /** job.updatedAt was stamped at claim time, so now - updatedAt ≈ processing time. */
  private observeDuration(job: Job): void {
    const seconds = Math.max(0, this.now() - job.updatedAt) / 1000;
    metrics.duration.observe({ queue: job.queue, type: job.type }, seconds);
  }
}
