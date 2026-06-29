import { startWorker } from "./start.js";

/**
 * Standalone worker process. Run several of these (or scale the service's replica
 * count) to process the queue in parallel. Each is stateless and self-coordinates
 * via Redis. For a single-service (free) deploy, the API can run this inline instead
 * (RUN_WORKER_INLINE=true).
 */
await startWorker();
