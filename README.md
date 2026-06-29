# QueueFlow — Distributed Job Processing System

A distributed job queue built on a **custom Redis/Lua engine** (not a BullMQ wrapper),
with a durable Postgres audit log, a REST API, full observability, and a live Next.js
dashboard.

- **Engine** — atomic Lua scripts for `enqueue / claim / ack / nack / reaper / promote`;
  priority + FIFO scoring, visibility-timeout leases, crash recovery, exponential backoff
  with jitter, dead-letter queue.
- **Durability** — every lifecycle event projects into Postgres (`jobs`, `job_events`,
  `dead_letter`) via a decoupled `QueueHooks` interface. The engine never imports a DB driver.
- **API** — Express + JWT auth (access/refresh), idempotency keys, atomic token-bucket
  rate limiting, job CRUD, admin DLQ/stats, pause/resume.
- **Observability** — Prometheus metrics, Grafana dashboard, and a WebSocket gateway that
  streams live job updates from Redis pub/sub.
- **Dashboard** — Next.js + React Query: stat cards, enqueue form, live jobs table, job
  timeline, DLQ requeue, live event feed.

## Architecture

```
   Dashboard (Next.js)
        │  REST + WebSocket
        ▼
   API (Express)  ──hooks──►  Postgres (audit)  ·  Prometheus (metrics)
        │                              ▲
        │ enqueue (atomic Lua)         │ project lifecycle events
        ▼                              │
      Redis  ◄──claim/ack/nack──  Worker pool (priority, retries, DLQ, crash recovery)
```

## Local development

```bash
npm install
npm run infra:up          # Redis + Postgres + Prometheus + Grafana (Docker)
npm run db:migrate        # apply schema
npm run api               # http://localhost:4000
npm run worker            # background processor
cd frontend && npm install && npm run dev   # http://localhost:3000
npm test                  # crash-recovery / DLQ / priority / idempotency suite
```

Grafana: http://localhost:3001 (admin/admin) · Prometheus: http://localhost:9090

Config is 12-factor — everything reads env vars (see `.env.example`). A local `.env` is
auto-loaded by the npm scripts.

## Deploy (Render + Neon + Upstash)

Managed Postgres (Neon) and Redis (Upstash) plug in via `DATABASE_URL` / `REDIS_URL` — no
code changes. The included `render.yaml` deploys the API (with the worker running inline)
and the static dashboard on Render's free tier.

1. **Postgres** — create a [Neon](https://neon.tech) project; copy its connection string
   (`?sslmode=require`).
2. **Redis** — create an [Upstash](https://upstash.com) Redis database; copy its `rediss://`
   connection string. (Upstash bills per request; the worker uses adaptive idle backoff and
   the blueprint sets conservative poll intervals to keep volume low.)
3. **Render** — New → Blueprint → point at this repo. When it syncs, paste `DATABASE_URL`
   and `REDIS_URL` into the `queueflow-secrets` group. `JWT_SECRET` is generated; the API and
   dashboard URLs wire to each other automatically (CORS + `NEXT_PUBLIC_API_URL`).
4. Open the dashboard URL, register a user, and enqueue jobs.

**Scaling out the worker:** set `RUN_WORKER_INLINE=false` on the API and add a Render
`type: worker` service running the same image with `node packages/worker/dist/index.js`.

See `.env.production.example` for every supported variable.

## Production build

```bash
docker build -t queueflow .                 # multi-stage; compiles TS -> dist
docker run --rm -e DATABASE_URL=... -e REDIS_URL=... -e JWT_SECRET=... \
  -e RUN_WORKER_INLINE=true -p 4000:4000 queueflow
```
