export type JobStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "retrying"
  | "dead"
  | "cancelled";

export interface Job {
  id: string;
  type: string;
  queue: string;
  status: JobStatus;
  priority: number;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  result: unknown;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobEvent {
  event: string;
  worker_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface JobDetail {
  job: Job;
  events: JobEvent[];
}

export interface QueueStats {
  live: Record<string, number>;
  totals: Record<string, number>;
}

export interface DeadLetterRow {
  job_id: string;
  failure_reason: string | null;
  attempts: number | null;
  failed_at: string;
}

/** Live event pushed over the WebSocket gateway. */
export interface LiveEvent {
  event: "connected" | "created" | "started" | "completed" | "failed" | "recovered";
  queue?: string;
  jobId?: string | string[];
  type?: string;
  status?: string;
  outcome?: "retry" | "dead";
  ts?: number;
}
