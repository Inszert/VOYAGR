/**
 * Apply SQL migrations.
 *
 * Deliberately minimal: read `src/db/migrations/*.sql` in filename order, apply
 * each one that has not been applied, record it. No migration framework, because
 * the schema is small and a framework would be more moving parts than schema.
 *
 * Each migration runs inside a transaction, so a failure leaves nothing halfway.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... npm run db:migrate
 *
 * The application does not need this to run. With DATABASE_URL unset the
 * in-memory repositories are used and this script simply reports that.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'src', 'db', 'migrations');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error(
    'DATABASE_URL is not set.\n' +
      'The application runs without it using in-memory repositories.\n' +
      'Set it only when you want to apply the schema to a real database.',
  );
  process.exit(1);
}

const { Pool } = await import('pg');

const pool = new Pool({
  connectionString,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
  connectionTimeoutMillis: 10_000,
});

async function main() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const { rows } = await pool.query('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map((row) => row.name));

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('No migrations found.');
    return;
  }

  let count = 0;

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip    ${file} (already applied)`);
      continue;
    }

    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();

    try {
      // The migration files carry their own BEGIN/COMMIT, so the bookkeeping
      // insert is what this transaction wraps.
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      console.log(`applied ${file}`);
      count += 1;
    } catch (error) {
      console.error(`failed  ${file}`);
      console.error(error instanceof Error ? error.message : error);
      throw error;
    } finally {
      client.release();
    }
  }

  console.log(count === 0 ? 'Schema already up to date.' : `Applied ${count} migration(s).`);
}

try {
  await main();
} catch {
  process.exitCode = 1;
} finally {
  await pool.end();
}
