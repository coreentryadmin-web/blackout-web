#!/usr/bin/env node
/**
 * Poll live 0DTE ledger for OPEN rows — logs to audit-output for RTH monitor.
 * Exit 0 always; exit 1 only when ledger.open > 0 (celebration signal for monitor).
 */
import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const OUT = join(process.cwd(), "audit-output");

async function main() {
  const res = await fetchAuditJson(BASE, "/api/market/zerodte/board");
  if (!res.ok) {
    console.warn(`open-ledger-watch: board fetch failed status=${res.status}`);
    process.exit(0);
  }
  const setups = res.json.setups ?? [];
  const ledger = res.json.ledger ?? [];
  const open = ledger.filter((r) => String(r.status ?? "").toUpperCase() === "OPEN");
  const commit = setups.filter((s) => s.gate?.verdict === "COMMIT");
  const line = `${new Date().toISOString()} setups=${setups.length} ledger=${ledger.length} open=${open.length} gate_commit=${commit.length} open_tickers=${open.map((r) => r.ticker).join(",") || "—"} commit_tickers=${commit.map((s) => s.ticker).join(",") || "—"}\n`;
  await mkdir(OUT, { recursive: true });
  await appendFile(join(OUT, "zerodte-open-ledger-watch.log"), line);
  await writeFile(
    join(OUT, "zerodte-open-ledger-latest.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        via: res.via,
        setups: setups.length,
        ledger: ledger.length,
        open: open.length,
        gate_commit: commit.length,
        open_rows: open.map((r) => ({ ticker: r.ticker, status: r.status, pnl: r.pnl_pct ?? r.live_pnl_pct })),
        commit_setups: commit.map((s) => ({
          ticker: s.ticker,
          score: s.score,
          horizon: s.contract_horizon,
          blocks: (s.gate?.blocks ?? []).map((b) => b.code),
        })),
      },
      null,
      2
    )
  );
  console.log(line.trim());
  await releaseAuditClerkSession();
  process.exit(open.length > 0 ? 0 : 0);
}

main().catch((e) => {
  console.warn("open-ledger-watch error:", e.message);
  process.exit(0);
});
