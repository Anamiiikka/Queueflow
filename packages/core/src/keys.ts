/** Centralised Redis key naming so every component agrees on the layout. */

export const JOB_PREFIX = "job:";

export const keys = {
  pending: (queue: string) => `q:${queue}:pending`,
  delayed: (queue: string) => `q:${queue}:delayed`,
  processing: (queue: string) => `q:${queue}:processing`,
  dlq: (queue: string) => `q:${queue}:dlq`,
  events: (queue: string) => `q:${queue}:events`,
  job: (id: string) => `${JOB_PREFIX}${id}`,
  idem: (key: string) => `idem:${key}`,
  worker: (id: string) => `worker:${id}`,
} as const;
