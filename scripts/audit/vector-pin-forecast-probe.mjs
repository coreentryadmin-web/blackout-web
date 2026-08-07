#!/usr/bin/env node
/**
 * Vector pin-forecast smoke probe — exercises the LIVE generic forecast endpoint across a spread of
 * ticker shapes and prints what a member would actually get.
 *
 * The point is NOT "does it return 200". A forecast that always draws something is decoration, so
 * this reports, per ticker/target: whether a cone came back at all, the pin and its confidence, the
 * regime and magnet, and every honesty flag (`caveat` / `degraded` / `ivFallback`). A run where
 * thin single names honestly return `forecast: null` is a PASS, not a failure.
 *
 * Read-only. One temp Clerk user, released in `finally`.
 *
 * Usage:
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *     node scripts/audit/vector-pin-forecast-probe.mjs [--tickers=A,B] [--json]
 */
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";

const BASE = process.env.AUDIT_APP_URL || "https://blackouttrades.com";
const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const JSON_OUT = process.argv.includes("--json");
const TICKERS = arg("tickers", "SPX,SPY,QQQ,NVDA,AMD,META,ASTS").split(",").map((t) => t.trim()).filter(Boolean);
const TARGETS = ["expiry", "eod"];

const n = (x, d = 2) => (typeof x === "number" && Number.isFinite(x) ? x.toFixed(d) : "—");

async function main() {
  const rows = [];
  for (const ticker of TICKERS) {
    for (const target of TARGETS) {
      let res;
      try {
        res = await fetchAuditJson(BASE, `/api/market/vector/pin-forecast?ticker=${ticker}&target=${target}`);
      } catch (error) {
        rows.push({ ticker, target, error: error instanceof Error ? error.message : String(error) });
        continue;
      }
      // fetchAuditJson returns an ENVELOPE — {ok, status, json, via} — not the payload. Reading
      // res.forecast directly yields undefined for every ticker, which renders as a full column of
      // "honest refusals" and looks exactly like a correctly-degrading endpoint. Unwrap explicitly,
      // and surface a non-2xx as an ERROR so a broken call can never masquerade as a refusal.
      if (res && res.ok === false) {
        rows.push({ ticker, target, error: `HTTP ${res.status}` });
        continue;
      }
      const body = res && typeof res === "object" && "json" in res ? res.json : res;
      const f = body?.forecast ?? null;
      rows.push({
        ticker,
        target,
        // null is a legitimate, honest outcome — record it as such rather than as an error.
        cone: f ? (f.cone?.length ?? 0) : 0,
        available: f?.available ?? false,
        spot: f?.spot ?? null,
        pin: f?.pin ?? null,
        projectedClose: f?.projectedClose ?? null,
        pinPct: f?.pinPct ?? null,
        regime: f?.regime ?? null,
        magnet: f?.magnet ? `${f.magnet.kind}@${f.magnet.strike}` : null,
        charmState: f?.charmState ?? null,
        chainExpiry: f?.chainExpiry ?? null,
        targetYmd: f?.targetYmd ?? null,
        timeToCloseMin: f?.timeToCloseMin ?? null,
        degraded: f?.degraded ?? null,
        degradeReason: f?.degradeReason ?? null,
        ivFallback: f?.ivFallback ?? null,
        caveat: f?.caveat ?? null,
      });
    }
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ base: BASE, rows }, null, 2));
    return;
  }

  console.log(`\nVector pin-forecast probe — ${BASE}\n`);
  console.log(
    ["TICKER", "TARGET", "EXPIRY", "SPOT", "PIN", "PROJ", "CONF", "REGIME", "MAGNET", "CHARM", "CONE"]
      .map((h, i) => h.padEnd([7, 7, 11, 9, 9, 9, 6, 13, 18, 13, 5][i]))
      .join("")
  );
  for (const r of rows) {
    if (r.error) {
      console.log(`${r.ticker.padEnd(7)}${r.target.padEnd(7)}ERROR ${r.error}`);
      continue;
    }
    console.log(
      [
        r.ticker.padEnd(7),
        r.target.padEnd(7),
        String(r.chainExpiry ?? "—").padEnd(11),
        n(r.spot).padEnd(9),
        n(r.pin).padEnd(9),
        n(r.projectedClose).padEnd(9),
        (r.pinPct != null ? `${(r.pinPct * 100).toFixed(0)}%` : "—").padEnd(6),
        String(r.regime ?? "—").padEnd(13),
        String(r.magnet ?? "—").padEnd(18),
        String(r.charmState ?? "—").padEnd(13),
        String(r.cone),
      ].join("")
    );
    const flags = [
      r.degraded ? `DEGRADED(${r.degradeReason})` : null,
      r.ivFallback ? "IV-FALLBACK(guessed vol)" : null,
      r.caveat ? `CAVEAT: ${r.caveat}` : null,
      !r.available ? "NO CONE (honest refusal — thin/absent chain or no forward expiry)" : null,
    ].filter(Boolean);
    for (const f of flags) console.log(`         ↳ ${f}`);
  }

  const withCone = rows.filter((r) => !r.error && r.available).length;
  const nulls = rows.filter((r) => !r.error && !r.available).length;
  const errs = rows.filter((r) => r.error).length;
  console.log(`\n${withCone} cone(s), ${nulls} honest refusal(s), ${errs} error(s) across ${rows.length} probes.`);
  console.log("Errors are failures; refusals are not — a thin chain SHOULD return no cone.\n");
  if (errs) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => releaseAuditClerkSession().catch(() => {}));
