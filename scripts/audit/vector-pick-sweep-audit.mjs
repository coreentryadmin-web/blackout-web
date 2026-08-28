/**
 * Vector pick universe sweep — prod validation (read-only + optional cron force).
 *
 * Confirms the board API exposes leaders/winners and optionally hits the sweep cron.
 *
 * Run: node --import tsx scripts/audit/vector-pick-sweep-audit.mjs [--force-sweep] [--json]
 */
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const JSON_OUT = process.argv.includes("--json");
const FORCE_SWEEP = process.argv.includes("--force-sweep");

async function main() {
  const verdicts = [];

  if (FORCE_SWEEP) {
    const cronSecret = process.env.CRON_SECRET || "";
    const cronRes = await fetch(`${BASE}/api/cron/vector-pick-sweep?force=1`, {
      headers: { Authorization: `Bearer ${cronSecret}`, Accept: "application/json" },
    });
    const cron = await cronRes.json().catch(() => ({}));
    const sweepOk =
      cronRes.status === 202 ||
      cron.ok === true ||
      cron.status === "accepted" ||
      cron.skipped === true;
    verdicts.push({
      stage: "CRON-SWEEP",
      verdict: sweepOk ? "GREEN" : cronRes.status === 401 ? "AMBER" : "RED",
      detail:
        cron.reason ||
        cron.note ||
        cron.error ||
        `HTTP ${cronRes.status} ${JSON.stringify(cron).slice(0, 100)}`,
      httpStatus: cronRes.status,
    });
    if (cronRes.status === 202) await new Promise((r) => setTimeout(r, 12_000));
  }

  const board = await fetchAuditJson(BASE, "/api/market/vector/pick-closures/board?limit=500");
  if (!board.ok) {
    verdicts.push({ stage: "BOARD", verdict: "RED", detail: `HTTP ${board.status}` });
  } else {
    const j = board.json;
    const leaders = j.leaders?.length ?? 0;
    const winners = j.winners?.length ?? 0;
    const closed = j.closed?.length ?? 0;
    const hasShape = Array.isArray(j.leaders) && Array.isArray(j.winners) && j.coverage != null;
    verdicts.push({
      stage: "BOARD",
      verdict: hasShape ? "GREEN" : Array.isArray(j.closed) ? "AMBER" : "RED",
      detail: hasShape
        ? `leaders=${leaders} winners=${winners} closed=${closed}`
        : `legacy board (deploy pending) closed=${closed}`,
      leaders,
      winners,
      closed,
    });
    if (winners > 0) {
      const top = j.winners[0];
      verdicts.push({
        stage: "TOP-WINNER",
        verdict: "GREEN",
        detail: `${top.ticker} ${top.premium_pct_from_entry ?? top.peak_premium_pct}%`,
      });
    }
  }

  const worst = verdicts.some((v) => v.verdict === "RED")
    ? "RED"
    : verdicts.every((v) => v.verdict === "GREEN")
      ? "GREEN"
      : "AMBER";

  const out = { verdict: worst, base: BASE, verdicts };
  if (JSON_OUT) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`Vector pick sweep audit — ${worst}`);
    for (const v of verdicts) console.log(`  ${v.stage}: ${v.verdict} — ${v.detail}`);
  }

  await releaseAuditClerkSession();
  process.exit(worst === "RED" ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await releaseAuditClerkSession();
  process.exit(1);
});
