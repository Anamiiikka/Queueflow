import client from "prom-client";

/**
 * One Prometheus registry per process. The API and each worker expose their own
 * /metrics endpoint; Prometheus scrapes them all and aggregates. Default process
 * metrics (CPU, memory, event-loop lag) come for free via collectDefaultMetrics.
 */
export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry, prefix: "qf_" });

export const metrics = {
  enqueued: new client.Counter({
    name: "qf_jobs_enqueued_total",
    help: "Jobs enqueued",
    labelNames: ["queue", "type"],
    registers: [registry],
  }),
  completed: new client.Counter({
    name: "qf_jobs_completed_total",
    help: "Jobs completed successfully",
    labelNames: ["queue", "type"],
    registers: [registry],
  }),
  failed: new client.Counter({
    name: "qf_jobs_failed_total",
    help: "Job attempts that failed",
    labelNames: ["queue", "type", "outcome"], // outcome = retry | dead
    registers: [registry],
  }),
  recovered: new client.Counter({
    name: "qf_jobs_recovered_total",
    help: "Jobs recovered by the reaper after a lease expired",
    labelNames: ["queue"],
    registers: [registry],
  }),
  duration: new client.Histogram({
    name: "qf_job_duration_seconds",
    help: "Time from claim to completion",
    labelNames: ["queue", "type"],
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
  }),
  queueDepth: new client.Gauge({
    name: "qf_queue_depth",
    help: "Current number of jobs per state",
    labelNames: ["queue", "state"], // state = pending | delayed | processing | dlq
    registers: [registry],
  }),
};

/** Render the metrics exposition text (for an HTTP /metrics handler). */
export function renderMetrics(): Promise<string> {
  return registry.metrics();
}

export const contentType = registry.contentType;
