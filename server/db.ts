/**
 * PostgreSQL client for share data persistence.
 *
 * Table: shares
 *   id          uuid   PK default gen_random_uuid()
 *   analysis    jsonb  NOT NULL
 *   roast       jsonb  NOT NULL
 *   created_at  timestamptz default now()
 *
 * SQL to create:
 *   CREATE TABLE IF NOT EXISTS shares (
 *     id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *     analysis   jsonb NOT NULL,
 *     roast      jsonb NOT NULL,
 *     created_at timestamptz NOT NULL DEFAULT now()
 *   );
 */

import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  pool = new Pool({ connectionString, max: 5 });
  return pool;
}

/** Ensure the shares table exists (called once at startup) */
export async function initDb(): Promise<void> {
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS shares (
      id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      analysis   jsonb NOT NULL,
      roast      jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  console.log("[db] shares table ready");
}

// ─── Share CRUD ───────────────────────────────────────────────────────────────

export interface ShareRow {
  id: string;
  analysis: unknown;
  roast: unknown;
  created_at: Date;
}

/** Save analysis + roast, return the generated UUID */
export async function saveShare(
  analysis: unknown,
  roast: unknown,
): Promise<string> {
  const db = getPool();
  const res = await db.query<{ id: string }>(
    `INSERT INTO shares (analysis, roast) VALUES ($1, $2) RETURNING id`,
    [JSON.stringify(analysis), JSON.stringify(roast)],
  );
  return res.rows[0].id;
}

/** Fetch a share by ID. Returns null if not found. */
export async function getShare(id: string): Promise<ShareRow | null> {
  const db = getPool();
  const res = await db.query<ShareRow>(
    `SELECT * FROM shares WHERE id = $1`,
    [id],
  );
  return res.rows[0] ?? null;
}

// ─── Maintenance ──────────────────────────────────────────────────────────────

const EXPIRY_DAYS = 7;

/** Delete shares older than 7 days. Returns count deleted. */
export async function cleanExpiredShares(): Promise<number> {
  const db = getPool();
  const res = await db.query(
    `DELETE FROM shares WHERE created_at < now() - interval '${EXPIRY_DAYS} days'`,
  );
  return res.rowCount ?? 0;
}

/** Insert + delete a dummy row to keep database connection alive */
export async function keepAlive(): Promise<void> {
  const db = getPool();
  const res = await db.query<{ id: string }>(
    `INSERT INTO shares (analysis, roast) VALUES ('{"_keepalive":true}', '{"_keepalive":true}') RETURNING id`,
  );
  const id = res.rows[0]?.id;
  if (id) {
    await db.query(`DELETE FROM shares WHERE id = $1`, [id]);
  }
}
