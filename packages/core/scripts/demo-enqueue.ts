import { Redis } from "ioredis";
import { CoreQueue } from "../src/index.js";

/**
 * Dev helper: enqueue a spread of jobs across types and priorities, then print stats.
 *   npm run demo:enqueue            -> 20 jobs
 *   npm run demo:enqueue -- 200     -> 200 jobs
 */
const count = Number(process.argv[2] ?? 20);
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});
const queue = new CoreQueue(redis);

const samples = [
  { type: "email", payload: { to: "user@example.com", subject: "Welcome" }, priority: 2 as const },
  { type: "image", payload: { url: "s3://bucket/photo.jpg", sizes: [128, 512] }, priority: 3 as const },
  { type: "pdf", payload: { invoiceId: "INV-1001" }, priority: 4 as const },
  { type: "ai", payload: { task: "summarize", text: "Lorem ipsus dolor sit amet ..." }, priority: 5 as const },
];

for (let i = 0; i < count; i++) {
  const s = samples[i % samples.length]!;
  await queue.enqueue({ type: s.type, payload: s.payload, priority: s.priority, queue: "default" });
}

console.log(`enqueued ${count} jobs`);
console.log("queue stats:", await queue.stats("default"));
await redis.quit();
