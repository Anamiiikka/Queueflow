import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPool } from "./pool.js";

/** Apply schema.sql. Idempotent (all statements use IF NOT EXISTS). */
export async function migrate(connectionString?: string): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  // schema.sql sits next to this file in src/ (and is copied beside it in dist/).
  const sql = await readFile(join(here, "schema.sql"), "utf8");
  const pool = createPool(connectionString);
  try {
    await pool.query(sql);
  } finally {
    await pool.end();
  }
}

// Allow `tsx src/migrate.ts` as a CLI.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("migrate.ts")) {
  migrate()
    .then(() => {
      console.log("migration applied");
      process.exit(0);
    })
    .catch((err) => {
      console.error("migration failed:", err);
      process.exit(1);
    });
}
