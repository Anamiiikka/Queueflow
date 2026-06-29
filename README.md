# QueueFlow — Distributed Job Processing System

A distributed job queue built on a **custom Redis/Lua engine** (not a BullMQ wrapper),
with a durable Postgres audit log, a REST API, full observability (Prometheus + Grafana +
live WebSocket), and an interactive Next.js dashboard.

**▶ Live demo:** https://queueflow-dashboard.onrender.com
*(first load can take ~30–50s while the free API instance cold-starts, then it's snappy)*

- **Engine** — atomic Lua scripts for `enqueue / claim / ack / nack / reaper / promote`;
  priority + FIFO scoring, visibility-timeout leases, crash recovery, exponential backoff
  with jitter, dead-letter queue, adaptive idle backoff.
- **Durability** — every lifecycle event projects into Postgres (`jobs`, `job_events`,
  `dead_letter`) via a decoupled `QueueHooks` interface. The engine never imports a DB driver.
- **API** — Express + JWT auth (access/refresh + frictionless demo), idempotency keys, atomic
  token-bucket rate limiting, job CRUD, admin DLQ/stats, pause/resume, browser-triggered chaos.
- **Observability** — Prometheus metrics + a provisioned Grafana dashboard, plus a WebSocket
  gateway streaming live job updates from Redis pub/sub.
- **Dashboard** — Next.js + React Query: an interactive live **Job Flow** board (burst jobs,
  crash a worker on demand), throughput sparkline, jobs table, job timeline, DLQ requeue.

## Tech stack

TypeScript monorepo (npm workspaces) · Node + Express · Redis (ioredis + Lua) · PostgreSQL
(Neon) · prom-client / Prometheus / Grafana · `ws` WebSocket · Next.js 15 + React Query +
Tailwind · Docker · GitHub Actions CI · deployed on Render.

## Architecture

```
                       Dashboard (Next.js, static)
                          │  REST + WebSocket
                          ▼
   Prometheus ◄─/metrics─ API (Express + WS gateway) ──┐
   Grafana    ◄─scrape─   │         │ enqueue (Lua)     │ QueueHooks fan-out
                          │         ▼                   ├─► Postgres  (durable audit log)
                          │       Redis  ◄──claim/ack── ├─► Prometheus (metrics)
                          │         ▲      ──nack/reap── └─► Redis pub/sub → WebSocket
                          └─────────┴──── Worker pool (priority, retries, DLQ, recovery)
```

The same `QueueHooks` interface fans every engine transition out to **three sinks at once**
(Postgres, Prometheus, Redis pub/sub) via `combineHooks` — the core knows none of them exist.

## Observability

Every process exposes Prometheus metrics, and the Docker stack ships a ready-made Grafana
dashboard — no manual setup.

**Metrics** (`/metrics` on the API; the standalone worker serves its own on `:9100`):

| Metric | Type | Labels |
|---|---|---|
| `qf_jobs_enqueued_total` | counter | queue, type |
| `qf_jobs_completed_total` | counter | queue, type |
| `qf_jobs_failed_total` | counter | queue, type, outcome (retry/dead) |
| `qf_jobs_recovered_total` | counter | queue |
| `qf_job_duration_seconds` | histogram | queue, type |
| `qf_queue_depth` | gauge | queue, state (pending/delayed/processing/dlq) |

…plus default process metrics (CPU, memory, event-loop lag).

**Prometheus** (`monitoring/prometheus.yml`) scrapes the API and worker every 5s →
http://localhost:9090 (check Status → Targets).

**Grafana** → http://localhost:3001 (`admin` / `admin`). The Prometheus datasource and the
**QueueFlow Overview** dashboard are auto-provisioned (`monitoring/grafana/provisioning/`).
Panels:

- **Throughput** — completed jobs/sec by type
- **Failures/sec** — by outcome (retry vs dead)
- **Queue depth** — by state (pending / delayed / processing / dlq)
- **Job duration** — p50 / p95 / p99 (from the histogram)
- **Stats** — total completed · total dead-lettered · jobs recovered after a crash

**Live updates** — the API's WebSocket gateway pattern-subscribes to `q:*:events` and fans
each transition to dashboard clients, so the UI updates with **zero polling**.

## Benchmarks

Engine throughput on a local Redis (no-op handler, so this measures the queue itself —
`npm run loadtest -- 20000 50`):

| Metric | Result |
|---|---|
| Enqueue throughput | **~25,000 jobs/sec** |
| Process throughput (claim + ack) | **~15,000 jobs/sec** |
| Steady-state round-trip latency (enqueue → claim → ack) | **p50 1 ms · p99 2 ms** |

## Fault tolerance (chaos test)

`npm run chaos` enqueues 20 jobs, lets a worker claim 6 and **kills it mid-flight**
(leases abandoned), then starts a survivor whose reaper recovers the orphaned jobs:

```
2. worker-1 claimed 6 jobs, then 💥 CRASHED (leases abandoned).
   queue now: 14 pending, 6 stuck in-flight (held by the dead worker).
3. worker-2 starts. Its reaper recovers the dead worker's jobs after the 2000ms lease…
   [reaper] recovered expired jobs  count=6
=== Result ===
Jobs enqueued : 20 · completed : 20 · recovered after crash : 6 · lost : 0 · reprocessed twice : 0
✅ PASS — no work lost; the crashed worker's jobs were recovered and completed.
```

The same guarantee is asserted in the test suite (`npm test`): *"requeues a crashed
worker's job and runs it exactly once."* You can also trigger this **from the dashboard** —
the "Crash a worker" button calls `POST /admin/chaos`, which injects stuck jobs the reaper
then recovers live.

## Local development

```bash
npm install
npm run infra:up          # Redis + Postgres + Prometheus + Grafana (Docker)
npm run db:migrate        # apply schema
npm run api               # http://localhost:4000
npm run worker            # background processor
cd frontend && npm install && npm run dev   # http://localhost:3000
npm test                  # crash-recovery / DLQ / priority / idempotency suite
npm run loadtest          # throughput benchmark
npm run chaos             # crash-recovery demo
```

| Service | URL |
|---|---|
| Dashboard | http://localhost:3000 |
| API + WebSocket | http://localhost:4000 |
| Grafana | http://localhost:3001 (`admin` / `admin`) |
| Prometheus | http://localhost:9090 |

Config is 12-factor — everything reads env vars (see `.env.example`). A local `.env` is
auto-loaded by the npm scripts.

## Deploy (Render + Neon + Upstash)

Managed Postgres (Neon) and Redis (Upstash) plug in via `DATABASE_URL` / `REDIS_URL` — no
code changes. The included `render.yaml` deploys the API (with the worker running inline)
and the static dashboard on Render's free tier.

1. **Postgres** — create a [Neon](https://neon.tech) project; copy its connection string
   (`?sslmode=require`). Run `npm run db:migrate` against it once.
2. **Redis** — create an [Upstash](https://upstash.com) Redis database; copy its `rediss://`
   connection string. (Upstash bills per request; the worker uses adaptive idle backoff and
   the blueprint sets conservative poll intervals to keep volume low.)
3. **Render** — New → Blueprint → point at this repo. When it syncs, paste `DATABASE_URL`
   and `REDIS_URL` into the `queueflow-secrets` group. `JWT_SECRET` is generated.
4. Open the dashboard URL — it auto-creates a demo session (no sign-up) and you can enqueue
   jobs immediately.

The dashboard skips sign-in via `POST /auth/demo` (toggle with `ALLOW_DEMO_AUTH`). Set the
deployed service URLs explicitly (`NEXT_PUBLIC_API_URL`, `CORS_ORIGINS`) — Render's
`fromService host` resolves to a bare slug, so the blueprint pins the full `*.onrender.com`
URLs. **Scaling out the worker:** set `RUN_WORKER_INLINE=false` and add a Render
`type: worker` service running `node packages/worker/dist/index.js`.

See `.env.production.example` for every supported variable.

## Production build

```bash
docker build -t queueflow .                 # multi-stage; compiles TS -> dist
docker run --rm -e DATABASE_URL=... -e REDIS_URL=... -e JWT_SECRET=... \
  -e RUN_WORKER_INLINE=true -p 4000:4000 queueflow
```

CI (`.github/workflows/ci.yml`) runs typecheck + build, the integration suite against a live
Redis service, the Docker image build, and the frontend static export on every push.
