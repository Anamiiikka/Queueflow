import { Redis } from "ioredis";
import { CoreQueue } from "@queueflow/core";

/**
 * Engine throughput benchmark. Measures the queue itself (enqueue + claim/ack) with a
 * no-op handler, so the numbers reflect the Redis/Lua engine — not the simulated job
 * latency in the demo handlers.
 *
 *   npm run loadtest                 # 20k jobs, 50-way concurrency
 *   npm run loadtest -- 50000 100    # 50k jobs, 100-way concurrency
 */
const TOTAL = Number(process.argv[2] ?? 20_000);
const CONCURRENCY = Number(process.argv[3] ?? 50);
const QUEUE = "bench";

// Isolate on a scratch DB so teardown is a clean flushdb that never touches dev data.
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  db: 14,
  maxRetriesPerRequest: null,
});
const q = new CoreQueue(redis, { leaseMs: 120_000 });

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i]!;
}

/** Run `total` units of work across `concurrency` async workers. */
async function pool(total: number, concurrency: number, fn: (i: number) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= total) return;
      await fn(i);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
}

async function main() {
  console.log(`\nQueueFlow load test — ${TOTAL} jobs, ${CONCURRENCY}-way concurrency\n`);
  await redis.flushdb(); // scratch DB 14 — clean slate

  // --- enqueue throughput ---
  let t = Date.now();
  await pool(TOTAL, CONCURRENCY, async () => {
    await q.enqueue({ type: "bench", queue: QUEUE, payload: { t: Date.now() } });
  });
  const enqMs = Date.now() - t;
  const enqRate = Math.round((TOTAL / enqMs) * 1000);

  // --- process throughput (drain the backlog as fast as possible) ---
  let processed = 0;
  t = Date.now();
  await pool(CONCURRENCY, CONCURRENCY, async () => {
    while (true) {
      const job = await q.claim(QUEUE, "bench-worker");
      if (!job) return; // queue drained
      await q.ack(QUEUE, job, { ok: true });
      processed++;
    }
  });
  const procMs = Date.now() - t;
  const procRate = Math.round((processed / procMs) * 1000);

  // --- steady-state per-job latency (not backlogged): enqueue → claim → ack ---
  const lat: number[] = [];
  for (let i = 0; i < 500; i++) {
    const s = Date.now();
    const { id } = await q.enqueue({ type: "bench", queue: QUEUE, payload: {} });
    const job = await q.claim(QUEUE, "bench-worker");
    await q.ack(QUEUE, job ?? ({ id } as never), { ok: true });
    lat.push(Date.now() - s);
  }
  lat.sort((a, b) => a - b);

  console.log(`Enqueue : ${TOTAL} jobs in ${enqMs} ms  ->  ${enqRate.toLocaleString()} jobs/sec`);
  console.log(`Process : ${processed} jobs in ${procMs} ms  ->  ${procRate.toLocaleString()} jobs/sec`);
  console.log(
    `Latency : steady-state round-trip (enqueue→claim→ack) p50 ${pct(lat, 50)} ms · p95 ${pct(lat, 95)} ms · p99 ${pct(lat, 99)} ms`,
  );
  console.log();

  await redis.flushdb();
  await redis.quit();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
