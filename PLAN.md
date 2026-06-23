# QueueFlow — Distributed Job Processing System

> A resume-grade distributed job queue that proves systems depth, not just library usage.
>
> **Core thesis:** Most applicants submit a BullMQ wrapper. This project ships a **hand-written
> atomic Redis/Lua queue core** (so you can explain the internals cold), backed by **real
> benchmark numbers**, a **chaos-recovery demo**, and **end-to-end observability**. That is the
> difference between "nice project" and "this person gets the interview."

---

## 0. Decisions locked in

- **Queue engine:** Custom core + BullMQ. The main job path runs through a hand-written
  Redis/Lua `CoreQueue` (atomic claim, visibility timeout, crash recovery). BullMQ stays
  available for comparison and for advanced features (repeatable jobs, flow producers) so you
  can speak to both.
- **Delivery semantics:** At-least-once + idempotency keys. (Be ready to explain why
  exactly-once across a network is a myth.)
- **Source of truth:** PostgreSQL is durable record; Redis is the fast working set. Caches are
  not databases.

---

## 1. The "why this is hard" talking points (memorize these)

When an interviewer hears "distributed queue," they will probe these. Have crisp answers:

1. **How does exactly one worker claim a job?**
   An atomic Lua script pops from the `pending` sorted set and writes the job into a
   `processing` ZSET with a `locked_until` deadline — in a single round trip, so two workers
   can never both win.
2. **What happens if a worker dies mid-job?**
   Its lease (`locked_until`) expires. A **reaper** scans the `processing` ZSET for entries
   past their deadline and requeues them. The job is re-run (at-least-once) — which is why
   handlers must be idempotent.
3. **Why not exactly-once?**
   Because a worker can finish the job and crash before acking. You cannot atomically "do side
   effect + ack" across two systems. So: at-least-once delivery + idempotent handlers +
   idempotency keys = effectively-once *outcomes*.
4. **How do you keep priority + FIFO fairness?**
   ZSET score = `priority * 1e13 + enqueueTimestampMs`. Lower score = served first. Same
   priority preserves arrival order.
5. **How does this scale horizontally?**
   Workers are stateless and all `BRPOPLPUSH`/Lua-claim from the same Redis. Add containers =
   add throughput. Postgres holds durable state; Redis holds the hot working set.

---

## 2. Architecture

```
                    ┌─────────────┐
   Clients ───────► │  API Layer  │ ◄──── JWT, rate-limit, idempotency keys
   (REST + WS)      │  (Express)  │
                    └──────┬──────┘
                           │ enqueue (atomic Lua)
              ┌────────────┼────────────┐
         ┌────▼────┐  ┌────▼────┐  ┌────▼─────┐
         │Postgres │  │  Redis  │  │ OTel /   │
         │(source  │  │(queue + │  │ Prom     │
         │of truth)│  │ pubsub) │  │ metrics  │
         └─────────┘  └────┬────┘  └──────────┘
                           │ Lua claim / BRPOPLPUSH
        ┌──────────────────┼──────────────────┐
   ┌────▼────┐        ┌─────▼────┐       ┌──────▼───┐
   │Worker 1 │        │ Worker 2 │  ...  │ Worker N │  ◄── scaled via compose replicas
   │heartbeat,         │          │       │          │
   │graceful drain     └──────────┘       └──────────┘
   └─────────┘
        │ on crash → lease expires → reaper requeues
```

### Redis key layout

| Key | Type | Purpose |
|---|---|---|
| `q:{queue}:pending` | ZSET | jobs ready to run, scored by priority+time |
| `q:{queue}:delayed` | ZSET | scheduled/delayed jobs, scored by `available_at` |
| `q:{queue}:processing` | ZSET | in-flight jobs, scored by `locked_until` (lease) |
| `q:{queue}:dlq` | LIST | dead-lettered job ids |
| `job:{id}` | HASH | job body (type, payload, attempts, etc.) |
| `idem:{key}` | STRING | idempotency dedup, TTL'd |
| `worker:{id}` | HASH | heartbeat, current job, counters |
| `q:{queue}:events` | Pub/Sub | live updates → WebSocket fan-out |

A **promoter** loop moves due jobs from `delayed` → `pending`. The **reaper** moves expired
`processing` jobs back to `pending` (incrementing attempts; → DLQ past `max_attempts`).

---

## 3. Database schema (PostgreSQL)

```sql
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',   -- user | admin
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type            TEXT NOT NULL,
  queue           TEXT NOT NULL DEFAULT 'default',
  status          TEXT NOT NULL DEFAULT 'pending', -- pending|processing|completed|failed|retrying|dead|cancelled
  priority        INT  NOT NULL DEFAULT 5,         -- 1=highest
  payload         JSONB NOT NULL,
  idempotency_key TEXT UNIQUE,
  attempts        INT  NOT NULL DEFAULT 0,
  max_attempts    INT  NOT NULL DEFAULT 5,
  available_at    TIMESTAMPTZ NOT NULL DEFAULT now(),  -- delayed/scheduled
  locked_by       TEXT,
  locked_until    TIMESTAMPTZ,
  depends_on      UUID[] NOT NULL DEFAULT '{}',        -- DAG prerequisites
  result          JSONB,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_jobs_claim ON jobs (status, priority, available_at);
CREATE INDEX idx_jobs_user_created ON jobs (created_at DESC);

CREATE TABLE job_events (
  id         BIGSERIAL PRIMARY KEY,
  job_id     UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  event      TEXT NOT NULL,           -- created|started|retry|completed|failed|dead|cancelled
  worker_id  TEXT,
  metadata   JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_events_job ON job_events (job_id, created_at);

CREATE TABLE workers (
  id             TEXT PRIMARY KEY,        -- hostname:pid
  status         TEXT NOT NULL,           -- idle|busy|draining|dead
  last_heartbeat TIMESTAMPTZ NOT NULL,
  current_job_id UUID,
  jobs_completed BIGINT NOT NULL DEFAULT 0,
  jobs_failed    BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE dead_letter (
  job_id          UUID PRIMARY KEY,
  original_payload JSONB NOT NULL,
  failure_reason  TEXT,
  attempts        INT,
  failed_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

> Postgres is the durable audit log + admin query surface. Redis is the live engine. The two
> reconcile: every state transition writes a `job_events` row.

---

## 4. The custom queue core (the crown jewel)

Build this **first**. Target ~200–300 lines. Three Lua scripts make it bulletproof:

### `enqueue.lua`
- `KEYS = pending, job hash`; `ARGV = id, score, body`
- `HSET job:{id} ...`; `ZADD pending score id`. One atomic step.

### `claim.lua`
- `KEYS = pending, processing`; `ARGV = now, leaseMs, workerId`
- `ZRANGEBYSCORE pending -inf +inf LIMIT 0 1` → if found:
  `ZREM pending id`; `ZADD processing (now+leaseMs) id`; set `locked_by`. Return job id.
- Atomic: two workers can never claim the same id.

### `ack.lua` / `nack.lua`
- `ack`: `ZREM processing id`; delete job hash (or mark done).
- `nack`: compute backoff, either `ZADD pending newScore id` (retry) or push to DLQ.

### Background loops (each its own interval timer)
- **Reaper:** `ZRANGEBYSCORE processing -inf now` → expired leases → requeue (attempts++) or DLQ.
- **Promoter:** `ZRANGEBYSCORE delayed -inf now` → move to pending.
- **Heartbeat:** each worker `HSET worker:{id} last_heartbeat now` every 2s.

### Retry backoff
`delay = min(baseMs * 2^attempts, maxMs) + random_jitter`. Jitter prevents thundering herd —
**mention this explicitly**, it's a senior signal.

### Graceful shutdown (SIGTERM)
1. Stop claiming new jobs (enter `draining`).
2. Finish in-flight job (with a hard timeout).
3. Ack, update worker status `dead`, close connections, exit 0.
Compose/orchestrators send SIGTERM on scale-down — handling it = zero lost work.

---

## 5. REST API

```
Auth
  POST   /auth/register
  POST   /auth/login            -> { accessToken, refreshToken }
  POST   /auth/refresh
  POST   /auth/logout

Jobs   (JWT required; Idempotency-Key header supported on POST /jobs)
  POST   /jobs                  -> create  { type, queue?, priority?, payload, delayMs?, runAt?, dependsOn? }
  GET    /jobs                  -> list/filter (status, type, queue, pagination)
  GET    /jobs/:id              -> status + event timeline
  DELETE /jobs/:id              -> remove
  POST   /jobs/:id/retry        -> requeue (also works from DLQ)
  POST   /jobs/:id/cancel       -> cancel if not yet running

Admin / ops
  GET    /queues                -> per-queue depth, rates, latency
  GET    /queues/:q/pause       -> stop processing (maintenance)
  GET    /queues/:q/resume
  GET    /workers               -> health, current job, counters
  GET    /dlq                   -> dead-letter inspection
  POST   /dlq/:id/requeue
  GET    /metrics               -> Prometheus exposition
  GET    /health                -> liveness/readiness
```

Cross-cutting: JWT auth + refresh, **per-user rate limiting** (Redis token bucket — prevents
queue flooding), **idempotency keys** (dedup window in Redis), Zod request validation,
structured logging with request/trace ids.

---

## 6. Job types (simulated handlers)

Each handler is async, can randomly fail (configurable failure rate to demo retries/DLQ), and
emits progress events:

- **email** — "send welcome email" (random SMTP failure to trigger backoff).
- **image** — compress / resize / thumbnail (simulate CPU work with a delay).
- **pdf** — invoice / report generation.
- **ai** — call an LLM to summarize / tag / translate (stub or real Anthropic call).

`dependsOn` enables a **DAG**: e.g. `generate-invoice → generate-pdf → send-email`. A job only
becomes claimable once all `depends_on` jobs are `completed`.

---

## 7. Observability stack

- **Prometheus** metrics: `jobs_enqueued_total`, `jobs_processed_total{status}`,
  `job_duration_seconds` (histogram), `queue_depth{queue}`, `worker_active`, `retry_total`,
  `dlq_total`. Expose at `/metrics`.
- **Grafana** dashboards: throughput, p50/p95/p99 latency, queue depth over time, worker
  health, DLQ growth. Commit the dashboard JSON to the repo.
- **OpenTelemetry → Jaeger:** trace a single job API request → enqueue → claim → process →
  complete as one distributed trace. This visibly proves observability maturity.
- **Structured logs** (pino) with trace ids correlating logs ↔ traces.
- **WebSocket** live updates: subscribe to Redis pub/sub, push job state changes to the
  dashboard with no polling.

---

## 8. Frontend dashboard (Next.js + TS + Tailwind + React Query)

- **Overview:** total / running / failed / queued counts, throughput sparkline, queue depth.
- **Jobs table:** filter by status/type/queue, paginated, live-updating via WS.
- **Job detail:** full event timeline (created → started → retry → completed), payload, result,
  error, attempt history.
- **Worker panel:** per-worker status, current job, completed/failed counters, last heartbeat.
- **DLQ inspector:** list dead jobs, view failure reason, one-click requeue.
- **Controls:** pause/resume a queue, retry/cancel a job.

---

## 9. Proof of quality (this is what closes the deal)

- **Load test (k6 or autocannon):** drive enqueues at high RPS; record sustained
  enqueue/sec, process/sec, and p99 latency. **Put the numbers on your resume and README.**
- **Chaos demo:** a script that `kill -9`s a random worker mid-job; show in the dashboard the
  job recovering and completing exactly once. **Record a 20–30s GIF for the README.**
- **The credential test:** an integration test asserting "killed worker → job reprocessed
  exactly once." This single test *is* your distributed-systems proof.
- **CI (GitHub Actions):** lint, typecheck, unit + integration tests (Testcontainers spins up
  real Redis + Postgres), Docker build. Green badge in README.
- **Live deploy:** Railway / Render / Fly.io link so reviewers can click and see it run.

---

## 10. Repo / folder structure

```
queueflow/
├── docker-compose.yml          # api, worker(x3), postgres, redis, grafana, prometheus, jaeger
├── .github/workflows/ci.yml
├── packages/
│   ├── core/                   # the custom queue engine (publishable feel)
│   │   ├── src/
│   │   │   ├── CoreQueue.ts
│   │   │   ├── lua/{enqueue,claim,ack,nack}.lua
│   │   │   ├── reaper.ts  promoter.ts  backoff.ts
│   │   │   └── types.ts
│   │   └── test/               # exactly-once / crash-recovery tests
│   ├── api/
│   │   ├── src/{controllers,routes,middleware,services,db,ws,config}/
│   │   └── src/app.ts
│   ├── worker/
│   │   └── src/{handlers,worker.ts,shutdown.ts,heartbeat.ts}
│   └── shared/                 # zod schemas, types, logger, otel setup
├── frontend/                   # Next.js dashboard
├── load/                       # k6 scripts + chaos scripts
├── grafana/                    # dashboard JSON + provisioning
└── README.md                   # architecture diagram, benchmarks, chaos GIF, design rationale
```

> Splitting the queue engine into `packages/core` makes it feel like a real library and makes
> the custom-internals story unmissable to a reviewer skimming the repo.

---

## 11. Phased build plan (~12 focused days)

Build in vertical slices so there's always something demoable. Ship Phases 1–3 first; everything
after is incremental polish you can stop at and still have a real project.

| Phase | Time | Deliverable |
|---|---|---|
| **0 — Foundation** | ½ day | Monorepo, docker-compose (PG+Redis+Grafana+Prom+Jaeger), TS config, Express skeleton, `/health`. |
| **1 — Core queue** | 2 days | Lua claim/ack/nack, `CoreQueue`, one worker processing one job type end to end. **Hardest part — do first.** |
| **2 — Reliability** | 2 days | Backoff+jitter, DLQ, visibility timeout + reaper, graceful shutdown. Write the killed-worker test. |
| **3 — API + Auth** | 1 day | Full job CRUD, JWT + refresh, rate limiting, idempotency keys, Zod validation. |
| **4 — Job types + scheduling** | 1 day | Email/image/pdf/ai handlers, delayed + scheduled jobs, priorities, DAG dependencies. |
| **5 — Observability** | 1½ days | Prometheus metrics, Grafana dashboards, OTel→Jaeger, structured logs, WebSocket updates. |
| **6 — Frontend** | 2 days | Next.js dashboard: overview, jobs table, job detail, worker health, DLQ inspector, live WS. |
| **7 — Proof & polish** | 1½ days | k6 benchmarks, chaos GIF, CI pipeline, architecture README, live deploy link. |

---

## 12. Resume bullets (fill the numbers in after Phase 7)

- Built a distributed job-processing system with a **custom Redis/Lua atomic queue core**
  (at-least-once delivery, visibility timeouts, crash recovery), sustaining **~__K enqueues/sec
  and __K jobs/sec** across horizontally-scaled workers at **p99 < __ms**.
- Engineered fault tolerance — exponential backoff with jitter, dead-letter queues, idempotency
  keys, and graceful drain on SIGTERM — **verified via chaos tests that kill workers mid-job
  and confirm exactly-one reprocessing**.
- Implemented end-to-end observability with **Prometheus, Grafana, and OpenTelemetry
  distributed tracing (Jaeger)**, plus a real-time Next.js dashboard streaming job state over
  WebSockets.
- Containerized 6 services with Docker Compose and shipped a **CI pipeline (GitHub Actions +
  Testcontainers)** running integration tests against ephemeral Redis/Postgres.

---

## 13. Interview prep checklist

Be able to whiteboard / explain on demand:
- [ ] The atomic claim — why a single Lua script, not GET-then-SET.
- [ ] At-least-once vs exactly-once, and where idempotency keys fit.
- [ ] Visibility timeout + reaper recovery flow.
- [ ] Priority + FIFO scoring math.
- [ ] Backoff with jitter and why jitter matters (thundering herd).
- [ ] Graceful shutdown sequence.
- [ ] Why Postgres + Redis (durable vs hot working set), and the reconciliation.
- [ ] Horizontal scaling story + where the bottleneck moves (Redis single-threaded → shard/cluster).
- [ ] One concrete number from your load test.
```
