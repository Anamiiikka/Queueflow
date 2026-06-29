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

// Run when invoked directly — works for both `tsx src/migrate.ts` (dev) and
// `node dist/migrate.js` (prod). Comparing the resolved module path to argv[1]
// is robust across OSes and file extensions.
const invokedPath = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;
if (invokedPath || process.argv[1]?.match(/migrate\.(ts|js)$/)) {
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
