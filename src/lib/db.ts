import { Pool, type QueryResultRow } from "pg";

let pool: Pool | null = null;

export function dbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function getPool(): Pool {
  if (!dbConfigured()) throw new Error("DATABASE_URL not set");
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 8,
      ssl: process.env.DATABASE_SSL === "0" ? false : { rejectUnauthorized: false },
    });
  }
  return pool;
}

let schemaReady: Promise<void> | null = null;

export async function ensureSchema(): Promise<void> {
  if (!dbConfigured()) return;
  if (!schemaReady) {
    schemaReady = (async () => {
      const p = getPool();
      await p.query(`
        CREATE TABLE IF NOT EXISTS flow_alerts (
          id BIGSERIAL PRIMARY KEY,
          alert_id TEXT UNIQUE,
          ticker TEXT,
          strike NUMERIC,
          expiry DATE,
          option_type TEXT,
          total_premium NUMERIC,
          score NUMERIC DEFAULT 0,
          source TEXT NOT NULL DEFAULT 'unusual_whales',
          created_at TIMESTAMPTZ,
          inserted_at TIMESTAMPTZ DEFAULT NOW(),
          raw_payload JSONB
        );
      `);
      await p.query(`
        CREATE INDEX IF NOT EXISTS idx_flow_alerts_created_at
        ON flow_alerts(created_at DESC);
      `);
      await p.query(`
        CREATE INDEX IF NOT EXISTS idx_flow_alerts_ticker
        ON flow_alerts(ticker);
      `);
      await p.query(`
        CREATE TABLE IF NOT EXISTS platform_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
    })();
  }
  await schemaReady;
}

export async function getMeta(key: string): Promise<string | null> {
  await ensureSchema();
  const res = await getPool().query<{ value: string }>(
    "SELECT value FROM platform_meta WHERE key = $1",
    [key]
  );
  return res.rows[0]?.value ?? null;
}

export async function setMeta(key: string, value: string): Promise<void> {
  await ensureSchema();
  await getPool().query(
    `INSERT INTO platform_meta (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, value]
  );
}

export type FlowRow = {
  ticker: string;
  premium: number;
  option_type: string;
  expiry: string;
  strike: number;
  direction: string;
  score: number;
  route: string;
  alerted_at: string;
};

export async function fetchRecentFlows(params: {
  limit: number;
  ticker?: string;
  min_premium?: number;
}): Promise<FlowRow[]> {
  await ensureSchema();
  const clauses: string[] = [];
  const values: (string | number)[] = [];
  let i = 1;

  if (params.ticker) {
    clauses.push(`ticker = $${i++}`);
    values.push(params.ticker.toUpperCase());
  }
  if (params.min_premium && params.min_premium > 0) {
    clauses.push(`COALESCE(total_premium, 0) >= $${i++}`);
    values.push(params.min_premium);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  values.push(params.limit);

  const res = await getPool().query<QueryResultRow>(
    `
    SELECT ticker,
           COALESCE(total_premium, 0) AS premium,
           option_type,
           expiry,
           strike,
           CASE WHEN LOWER(option_type) LIKE 'c%' THEN 'bullish' ELSE 'bearish' END AS direction,
           COALESCE(score, 0) AS score,
           CASE
             WHEN COALESCE(total_premium, 0) >= 1000000 THEN 'whale'
             WHEN expiry = CURRENT_DATE THEN '0dte'
             ELSE 'stock'
           END AS route,
           COALESCE(created_at, inserted_at) AS alerted_at
    FROM flow_alerts
    ${where}
    ORDER BY COALESCE(created_at, inserted_at) DESC NULLS LAST
    LIMIT $${i}
    `,
    values
  );

  return res.rows.map((row) => ({
    ticker: String(row.ticker ?? ""),
    premium: Number(row.premium ?? 0),
    option_type: String(row.option_type ?? "").toUpperCase(),
    expiry: row.expiry ? String(row.expiry).slice(0, 10) : "",
    strike: Number(row.strike ?? 0),
    direction: String(row.direction ?? "bullish"),
    score: Number(row.score ?? 0),
    route: String(row.route ?? "stock"),
    alerted_at: row.alerted_at ? new Date(String(row.alerted_at)).toISOString() : new Date().toISOString(),
  }));
}

export async function insertFlowAlert(row: {
  alert_id: string;
  ticker: string;
  strike: number | null;
  expiry: string | null;
  option_type: string;
  total_premium: number;
  score: number;
  created_at: string | null;
  raw_payload: unknown;
}): Promise<boolean> {
  await ensureSchema();
  const res = await getPool().query(
    `
    INSERT INTO flow_alerts (
      alert_id, ticker, strike, expiry, option_type,
      total_premium, score, source, created_at, raw_payload
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,'unusual_whales',$8,$9::jsonb)
    ON CONFLICT (alert_id) DO NOTHING
    RETURNING id
    `,
    [
      row.alert_id,
      row.ticker,
      row.strike,
      row.expiry,
      row.option_type,
      row.total_premium,
      row.score,
      row.created_at,
      JSON.stringify(row.raw_payload ?? {}),
    ]
  );
  return (res.rowCount ?? 0) > 0;
}
