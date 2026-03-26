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

  pool = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 10_000 });
  return pool;
}

/** Ensure tables exist (called once at startup) */
export async function initDb(): Promise<void> {
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS shares (
      id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      analysis   jsonb NOT NULL,
      roast      jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token      text PRIMARY KEY,
      mint       text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  console.log("[db] tables ready");
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

// ─── Sessions ─────────────────────────────────────────────────────────────────

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

export async function createSession(token: string, mint: string): Promise<void> {
  const db = getPool();
  await db.query(
    `INSERT INTO sessions (token, mint) VALUES ($1, $2)`,
    [token, mint],
  );
}

/**
 * Validate and consume a session token (one-time use).
 * Returns true if valid, false otherwise.
 */
export async function validateSession(token: string, mint: string): Promise<boolean> {
  const db = getPool();
  const res = await db.query<{ token: string; mint: string; created_at: Date }>(
    `DELETE FROM sessions WHERE token = $1 AND mint = $2 AND created_at > now() - interval '30 minutes' RETURNING token`,
    [token, mint],
  );
  return (res.rowCount ?? 0) > 0;
}

/** Clean expired sessions (called by maintenance interval) */
export async function cleanExpiredSessions(): Promise<number> {
  const db = getPool();
  const res = await db.query(
    `DELETE FROM sessions WHERE created_at < now() - interval '30 minutes'`,
  );
  return res.rowCount ?? 0;
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
