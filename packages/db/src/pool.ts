import pg from "pg";

/** A shared connection pool. One per process is plenty for our concurrency. */
export function createPool(connectionString?: string): pg.Pool {
  return new pg.Pool({
    connectionString:
      connectionString ??
      process.env.DATABASE_URL ??
      "postgres://queueflow:queueflow@127.0.0.1:5440/queueflow",
    max: 10,
    idleTimeoutMillis: 30_000,
  });
}

export type { Pool } from "pg";
