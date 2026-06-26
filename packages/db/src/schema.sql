-- QueueFlow durable schema. Postgres is the source of truth for the audit log and
-- admin queries; Redis holds the fast working set. Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jobs (
  id              UUID PRIMARY KEY,
  type            TEXT NOT NULL,
  queue           TEXT NOT NULL DEFAULT 'default',
  status          TEXT NOT NULL DEFAULT 'pending',
  priority        INT  NOT NULL DEFAULT 5,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key TEXT UNIQUE,
  attempts        INT  NOT NULL DEFAULT 0,
  max_attempts    INT  NOT NULL DEFAULT 5,
  available_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  depends_on      UUID[] NOT NULL DEFAULT '{}',
  result          JSONB,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jobs_claim ON jobs (status, priority, available_at);
CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_queue_status ON jobs (queue, status);

CREATE TABLE IF NOT EXISTS job_events (
  id         BIGSERIAL PRIMARY KEY,
  job_id     UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  event      TEXT NOT NULL,
  worker_id  TEXT,
  metadata   JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_job ON job_events (job_id, created_at);

CREATE TABLE IF NOT EXISTS workers (
  id             TEXT PRIMARY KEY,
  status         TEXT NOT NULL,
  last_heartbeat TIMESTAMPTZ NOT NULL,
  current_job_id UUID,
  jobs_completed BIGINT NOT NULL DEFAULT 0,
  jobs_failed    BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS dead_letter (
  job_id           UUID PRIMARY KEY,
  original_payload JSONB NOT NULL,
  failure_reason   TEXT,
  attempts         INT,
  failed_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
