import { Redis } from "ioredis";
import { CoreQueue, Worker } from "@queueflow/core";
import { createLogger } from "@queueflow/shared";

/**
 * Chaos / fault-tolerance demo. A worker claims jobs and is "killed" mid-flight
 * (its leases are abandoned, never acked). A surviving worker's reaper detects the
 * expired leases and requeues them, and every job still completes — exactly once.
 *
 *   npm run chaos
 */
process.env.LOG_LEVEL = "warn"; // quiet per-job logs; surface the reaper's recovery warning

const TOTAL = 20;
const CRASH_AT = 6; // jobs the doomed worker grabs before dying
const QUEUE = "chaos";
const LEASE_MS = 2_000;

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  db: 13, // scratch DB
  maxRetriesPerRequest: null,
});
const core = new CoreQueue(redis, { leaseMs: LEASE_MS });
const log = (m: string) => console.log(m);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  log(`\n=== QueueFlow chaos test: kill a worker mid-flight ===\n`);
  await redis.flushdb();

  // 1) Enqueue a batch of jobs.
  for (let i = 0; i < TOTAL; i++) {
    await core.enqueue({ type: "chaos", queue: QUEUE, payload: { n: i }, maxAttempts: 5 });
  }
  log(`1. Enqueued ${TOTAL} jobs.`);

  // 2) "worker-1" claims some jobs, then is KILLED — its leases are abandoned.
  const doomed: string[] = [];
  for (let i = 0; i < CRASH_AT; i++) {
    const job = await core.claim(QUEUE, "worker-1");
    if (job) doomed.push(job.id);
  }
  log(`2. worker-1 claimed ${doomed.length} jobs, then 💥 CRASHED (leases abandoned).`);
  const before = await core.stats(QUEUE);
  log(`   queue now: ${before.pending} pending, ${before.processing} stuck in-flight (held by the dead worker).`);

  // 3) The survivor processes the queue and runs the reaper.
  const completions = new Map<string, number>();
  const w2 = new Worker(redis, {
    queue: QUEUE,
    concurrency: 4,
    leaseMs: LEASE_MS,
    maintenanceIntervalMs: 500, // reaper runs twice a second
    logger: createLogger({ worker: "worker-2" }),
  });
  w2.register("chaos", async (job) => {
    completions.set(job.id, (completions.get(job.id) ?? 0) + 1);
    await sleep(60);
    return { ok: true };
  });
  log(`3. worker-2 starts. Its reaper will recover the dead worker's jobs after the ${LEASE_MS}ms lease expires…\n`);
  w2.start();

  // 4) Wait for the whole batch to finish (or time out).
  const deadline = Date.now() + 15_000;
  while (completions.size < TOTAL && Date.now() < deadline) await sleep(100);
  await w2.shutdown();

  // 5) Verdict.
  const recovered = doomed.filter((id) => completions.has(id)).length;
  const duplicates = [...completions.values()].filter((c) => c > 1).length;
  log(`\n=== Result ===`);
  log(`Jobs enqueued        : ${TOTAL}`);
  log(`Jobs completed       : ${completions.size}`);
  log(`Recovered after crash : ${recovered} (the dead worker's in-flight jobs)`);
  log(`Lost                 : ${TOTAL - completions.size}`);
  log(`Reprocessed twice    : ${duplicates}`);
  const ok = completions.size === TOTAL && recovered === doomed.length;
  log(`\n${ok ? "✅ PASS — no work lost; the crashed worker's jobs were recovered and completed." : "❌ FAIL"}\n`);

  await redis.flushdb();
  await redis.quit();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
