// Disposable PostgreSQL engine for full API tests; never connects to Supabase.
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DATABASE_URL = "postgresql://test:test@localhost/postgres";
process.env.DATABASE_APP_URL = "postgresql://test:test@localhost/postgres";
process.env.DB_SCHEMA = "mandoob_test_local";
process.env.APP_DATA_DIR = join(tmpdir(), "mandoob-local-postgres-test");
process.env.DISABLE_SCHEDULER = "1";
process.env.PORT = "4200";
const db = new PGlite();
await db.exec(
  "CREATE ROLE anon; CREATE ROLE authenticated; SET search_path=mandoob_test_local,public; SET TIME ZONE 'UTC';",
);
let connectionTail = Promise.resolve();
class LocalPool {
  on() {
    return this;
  }
  async query(text: string, values: unknown[] = []) {
    const parsers = Object.fromEntries(
      [20, 1700, 1082, 1114, 1184].map((oid) => [
        oid,
        pg.types.getTypeParser(oid),
      ]),
    );
    try {
      if (!values.length && /;\s*\S/.test(text)) {
        const results = await db.exec(text, { parsers });
        const result = results.at(-1)!;
        return {
          ...result,
          rowCount: result.affectedRows ?? result.rows.length,
        };
      }
      const result = await db.query(text, values, { parsers });
      return { ...result, rowCount: result.affectedRows ?? result.rows.length };
    } catch (error) {
      console.error("Test SQL:", text);
      throw error;
    }
  }
  async connect() {
    const prior = connectionTail;
    let unlock!: () => void;
    connectionTail = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    await prior;
    return {
      query: this.query.bind(this),
      release() {
        unlock();
      },
    };
  }
  async end() {}
}
(pg as any).Pool = LocalPool;
await import("./prepare-postgres.js");
await import("../src/index.js");
