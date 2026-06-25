import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Redis } from "ioredis";
import { CoreQueue } from "../src/index.js";
import { computeBackoff } from "../src/backoff.js";

/**
 * These tests are the distributed-systems credential. They assert the behaviours an
 * interviewer probes: a crashed worker's job is recovered and run exactly once,
 * idempotency keys dedupe, priority is honoured, and exhausted jobs dead-letter.
 *
 * Requires Redis on REDIS_URL (docker compose up -d redis). Uses DB 15 as a scratch db.
 */
const url = process.env.REDIS_URL ?? "redis://localhost:6379";
const redis = new Redis(url, { db: 15, maxRetriesPerRequest: null });

/** A controllable clock so we can expire leases without real waiting. */
let clock = 1_000_000_000_000;
const now = () => clock;
const advance = (ms: number) => {
  clock += ms;
};

before(async () => {
  await redis.flushdb();
});
beforeEach(async () => {
  await redis.flushdb();
  clock = 1_000_000_000_000;
});
after(async () => {
  await redis.flushdb();
  await redis.quit();
});

describe("CoreQueue crash recovery", () => {
  it("requeues a crashed worker's job and runs it exactly once", async () => {
    const q = new CoreQueue(redis, { now, leaseMs: 5_000 });
    const { id } = await q.enqueue({ type: "email", payload: { to: "a@b.c" } });

    // Worker A claims the job, then "crashes" — never acks or nacks.
    const claimedA = await q.claim("default", "workerA");
    assert.equal(claimedA?.id, id);
    assert.equal(claimedA?.attempts, 1);
    assert.equal(claimedA?.lockedBy, "workerA");

    // Before the lease expires, the job is invisible to other workers.
    assert.equal(await q.claim("default", "workerB"), null);

    // Lease expires -> the reaper recovers it back to pending.
    advance(6_000);
    const recovered = await q.reapExpired("default");
    assert.deepEqual(recovered, [id]);

    // Worker B now claims and completes it.
    const claimedB = await q.claim("default", "workerB");
    assert.equal(claimedB?.id, id);
    assert.equal(claimedB?.attempts, 2); // attempt counted at claim time
    await q.ack("default", claimedB!, { delivered: true });

    const final = await q.getJob(id);
    assert.equal(final?.status, "completed");
    assert.deepEqual(final?.result, { delivered: true });

    // Exactly once: the completed job is not re-delivered.
    assert.equal(await q.claim("default", "workerB"), null);
    const stats = await q.stats("default");
    assert.equal(stats.pending, 0);
    assert.equal(stats.processing, 0);
  });

  it("dead-letters a job once attempts are exhausted", async () => {
    const q = new CoreQueue(redis, { now, leaseMs: 5_000 });
    const { id } = await q.enqueue({ type: "email", payload: {}, maxAttempts: 1 });

    const job = await q.claim("default", "w1");
    assert.ok(job);
    const outcome = await q.nack("default", job, "SMTP down");
    assert.equal(outcome, "dead");

    const final = await q.getJob(id);
    assert.equal(final?.status, "dead");
    const stats = await q.stats("default");
    assert.equal(stats.dlq, 1);
  });

  it("retries with backoff and promotes the job back when due", async () => {
    const q = new CoreQueue(redis, { now, leaseMs: 5_000, random: () => 0.99 });
    const { id } = await q.enqueue({ type: "email", payload: {}, maxAttempts: 3 });

    const job = await q.claim("default", "w1");
    assert.ok(job);
    const outcome = await q.nack("default", job, "transient");
    assert.equal(outcome, "retry");

    // Immediately, the job is in delayed (not claimable yet).
    assert.equal(await q.claim("default", "w2"), null);

    // After the backoff window, the promoter makes it pending again.
    advance(120_000);
    const promoted = await q.promoteDue("default");
    assert.equal(promoted, 1);
    const retried = await q.claim("default", "w2");
    assert.equal(retried?.id, id);
  });

  it("honours priority: urgent jobs are claimed first", async () => {
    const q = new CoreQueue(redis, { now });
    await q.enqueue({ type: "email", payload: { tag: "low" }, priority: 5 });
    await q.enqueue({ type: "email", payload: { tag: "high" }, priority: 1 });

    const first = await q.claim("default", "w1");
    assert.equal((first?.payload as { tag: string }).tag, "high");
  });

  it("deduplicates by idempotency key", async () => {
    const q = new CoreQueue(redis, { now });
    const a = await q.enqueue({ type: "email", payload: {}, idempotencyKey: "order-42" });
    const b = await q.enqueue({ type: "email", payload: {}, idempotencyKey: "order-42" });

    assert.equal(a.created, true);
    assert.equal(b.created, false);
    assert.equal(a.id, b.id);
    const stats = await q.stats("default");
    assert.equal(stats.pending, 1);
  });
});

describe("backoff", () => {
  it("grows exponentially and stays within the ceiling", () => {
    const full = () => 1; // no jitter reduction -> returns the ceiling
    assert.equal(computeBackoff(1, full, { baseMs: 1000, maxMs: 60000 }), 1000);
    assert.equal(computeBackoff(2, full, { baseMs: 1000, maxMs: 60000 }), 2000);
    assert.equal(computeBackoff(3, full, { baseMs: 1000, maxMs: 60000 }), 4000);
    assert.equal(computeBackoff(20, full, { baseMs: 1000, maxMs: 60000 }), 60000); // capped
  });

  it("applies jitter below the ceiling", () => {
    const v = computeBackoff(5, () => 0.5, { baseMs: 1000, maxMs: 60000 });
    assert.ok(v >= 0 && v <= 16000);
  });
});
