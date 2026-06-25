import { Redis } from "ioredis";
import type { Job, QueueHooks } from "@queueflow/shared";
import { keys } from "./keys.js";

/** The shape pushed to subscribers (and on to WebSocket clients). */
export interface QueueEvent {
  event: "created" | "started" | "completed" | "failed" | "recovered";
  queue: string;
  jobId: string | string[];
  type?: string;
  status?: string;
  outcome?: "retry" | "dead";
  ts: number;
}

/**
 * Publishes engine transitions to a Redis pub/sub channel per queue. The API's
 * WebSocket gateway subscribes and fans these out to dashboard clients, giving live
 * job updates with no polling. Pub/sub is intentionally best-effort (the durable
 * record lives in Postgres); a missed live event just means a slightly stale UI.
 */
export class RedisEventPublisher implements QueueHooks {
  constructor(
    private readonly redis: Redis,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private publish(queue: string, payload: Omit<QueueEvent, "queue" | "ts">): Promise<number> {
    const event: QueueEvent = { ...payload, queue, ts: this.now() };
    return this.redis.publish(keys.events(queue), JSON.stringify(event));
  }

  async onCreated(job: Job): Promise<void> {
    await this.publish(job.queue, { event: "created", jobId: job.id, type: job.type, status: "pending" });
  }
  async onStarted(job: Job): Promise<void> {
    await this.publish(job.queue, { event: "started", jobId: job.id, type: job.type, status: "processing" });
  }
  async onCompleted(job: Job): Promise<void> {
    await this.publish(job.queue, { event: "completed", jobId: job.id, type: job.type, status: "completed" });
  }
  async onFailed(job: Job, outcome: "retry" | "dead"): Promise<void> {
    await this.publish(job.queue, {
      event: "failed",
      jobId: job.id,
      type: job.type,
      outcome,
      status: outcome === "dead" ? "dead" : "retrying",
    });
  }
  async onRecovered(queue: string, jobIds: string[]): Promise<void> {
    await this.publish(queue, { event: "recovered", jobId: jobIds });
  }
}
