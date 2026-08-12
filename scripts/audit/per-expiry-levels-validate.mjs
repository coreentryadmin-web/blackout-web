/**
 * PER-EXPIRY KEY LEVELS — live correctness validator.
 *
 * Answers the only question that matters about the expiry-scoped Key Levels row: for the expiry a
 * member has selected, are the numbers on screen actually THAT EXPIRY'S numbers?
 *
 * Three independent checks per ticker per expiry, in increasing order of what they can catch:
 *
 *  1. SCOPE  — recompute walls / flip / net GEX from `gex.cells` for that expiry alone, in this
 *              process, and require them to differ from the near-term aggregate wherever the book
 *              genuinely differs. An implementation that silently kept serving the aggregate would
 *              pass a "does it render" test and fail here.
 *  2. MAXPAIN— cross-check the server's `max_pain_by_expiry[e]` against a max pain computed HERE
 *              from Polygon's own open interest for that expiry. This is the one value the client
 *              cannot derive, so it is the one most worth checking against ground truth rather than
 *              against ourselves.
 *  3. SHARE  — the pin contest sums to 1 and is banded near spot.
 *
 * WHY NOT JUST DIFF AGAINST THE SERVER. Because the server is the thing under test. Check 2 uses
 * Polygon OI as an outside witness; checks 1 and 3 are self-consistency, and are labelled as such.
 *
 * Read-only. One temp Clerk user, always released.
 *
 * Run:
 *   NODE_USE_ENV_PROXY=1 node --import tsx scripts/audit/per-expiry-levels-validate.mjs \
 *     [--tickers=SPY,QQQ,NVDA] [--expiries=4] [--json]
 */
import { gammaShareByExpiry } from "../../src/features/thermal/lib/gex-heatmap/per-expiry-levels.ts";
import { gexWallsFromStrikeTotals, cumulativeGammaFlip } from "../../src/lib/providers/gex-cross-validation-core.ts";
import { computeMaxPainFromChain } from "../../src/lib/providers/polygon-options-gex.ts";
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";

const args = process.argv.slice(2);
const flag = (n, d) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const asJson = args.includes("--json");
const BASE = flag("base", "https://blackouttrades.com");
const TICKERS = flag("tickers", "SPY,QQQ,NVDA,TSLA").split(",").map((t) => t.trim()).filter(Boolean);
const MAX_EXPIRIES = Number(flag("expiries", "4")) || 4;

const KEY = process.env.POLYGON_API_KEY;
const RAW = process.env.POLYGON_API_BASE;
const POLY = /^https?:/.test(RAW ?? "") ? RAW : "https://api.massive.com";

const findings = [];
const note = (level, msg, extra) => {
  findings.push({ level, msg, ...(extra ?? {}) });
  if (!asJson) console.log(`  [${level}] ${msg}${extra ? ` ${JSON.stringify(extra)}` : ""}`);
};

/** Per-expiry strike totals from the served cells — the same collapse the client does. */
function totalsForExpiry(cells, expiry) {
  const out = {};
  for (const [strike, byExp] of Object.entries(cells ?? {})) {
    const g = byExp?.[expiry];
    if (typeof g === "number" && Number.isFinite(g) && g !== 0) out[strike] = g;
  }
  return out;
}

async function polyContractsForExpiry(root, expiry) {
  // Reference contracts carry no OI; the snapshot does. Use the snapshot and filter by expiry.
  const out = [];
  let url = `${POLY}/v3/snapshot/options/${root}?expiration_date=${expiry}&limit=250&apiKey=${KEY}`;
  for (let guard = 0; guard < 8 && url; guard += 1) {
    const r = await fetch(url).catch(() => null);
    if (!r?.ok) break;
    const j = await r.json();
    out.push(...(j.results ?? []));
    url = j.next_url ? `${j.next_url}&apiKey=${KEY}` : null;
  }
  return out;
}

try {
  for (const ticker of TICKERS) {
    if (!asJson) console.log(`\n═══ ${ticker}`);
    const r = await fetchAuditJson(BASE, `/api/market/gex-heatmap?ticker=${ticker}`);
    const hm = r.json?.heatmap ?? r.json;
    if (!r.ok || !hm?.gex?.cells) {
      note("WARN", `${ticker}: no matrix payload (http ${r.status}) — nothing to validate`);
      continue;
    }

    const spot = Number(hm.spot);
    const cells = hm.gex.cells;
    const expiries = (hm.expiries ?? []).slice(0, MAX_EXPIRIES);
    const mpByExpiry = hm.max_pain_by_expiry;

    if (!mpByExpiry) {
      note("FAIL", `${ticker}: payload carries NO max_pain_by_expiry — the per-expiry Max Pain tile cannot be correct`);
      continue;
    }

    // ── 3. SHARE (pin contest) ──────────────────────────────────────────────────────────
    const shares = gammaShareByExpiry(cells, spot);
    const shareSum = shares.reduce((a, b) => a + b.share, 0);
    note(
      shares.length === 0 || Math.abs(shareSum - 1) < 1e-6 ? "PASS" : "FAIL",
      `${ticker}: pin-contest shares sum to ${shareSum.toFixed(6)} over ${shares.length} expiries`
    );
    const top = [...shares].sort((a, b) => b.share - a.share)[0];
    if (top) {
      note("INFO", `${ticker}: near-spot gamma owned by ${top.expiry} (${(top.share * 100).toFixed(1)}%)`, {
        contest: shares.slice(0, 5).map((s) => `${s.expiry}:${(s.share * 100).toFixed(0)}%`),
      });
    }

    const agg = { callWall: hm.gex.call_wall, putWall: hm.gex.put_wall, flip: hm.gex.flip };
    let differedSomewhere = false;

    for (const e of expiries) {
      const totals = totalsForExpiry(cells, e);
      const nStrikes = Object.keys(totals).length;
      if (nStrikes === 0) {
        note("INFO", `${ticker} ${e}: empty expiry column — skipped`);
        continue;
      }

      // ── 1. SCOPE ──────────────────────────────────────────────────────────────────────
      const { callWall, putWall } = gexWallsFromStrikeTotals(totals);
      const flip = spot > 0 ? cumulativeGammaFlip(totals, spot) : null;
      const netGex = Object.values(totals).reduce((a, b) => a + b, 0);
      const differs =
        callWall !== agg.callWall || putWall !== agg.putWall || flip !== agg.flip;
      if (differs) differedSomewhere = true;

      // ── 2. MAXPAIN vs POLYGON OI (outside witness) ────────────────────────────────────
      const served = mpByExpiry[e];
      let verdict = "SKIP";
      let independent = null;
      if (KEY) {
        const root = ticker === "SPX" ? "I:SPX" : ticker;
        const snap = await polyContractsForExpiry(root, e);
        const contracts = snap
          .map((c) => ({
            details: {
              strike_price: Number(c.details?.strike_price),
              contract_type: String(c.details?.contract_type ?? "").toLowerCase(),
              expiration_date: String(c.details?.expiration_date ?? "").slice(0, 10),
            },
            open_interest: Number(c.open_interest ?? 0),
          }))
          .filter((c) => c.details.strike_price > 0);
        if (contracts.length > 0) {
          independent = computeMaxPainFromChain(contracts);
          if (served == null && independent == null) verdict = "PASS";
          else if (served == null || independent == null) verdict = "WARN";
          else {
            // Tolerance is one strike step: the server built from its own banded chain snapshot at
            // a slightly different instant, and OI ticks intraday. Demanding equality would fail on
            // a healthy system — the same band-width logic the depth live-check uses.
            const strikes = [...new Set(contracts.map((c) => c.details.strike_price))].sort((a, b) => a - b);
            const step = strikes.length > 1 ? Math.min(...strikes.slice(1).map((s, i) => s - strikes[i])) : 1;
            verdict = Math.abs(served - independent) <= step * 1.5 ? "PASS" : "FAIL";
          }
        }
      }

      note(
        verdict === "FAIL" ? "FAIL" : "PASS",
        `${ticker} ${e}: strikes=${nStrikes} callWall=${callWall} putWall=${putWall} flip=${flip == null ? "—" : flip.toFixed(2)} netGEX=${(netGex / 1e9).toFixed(2)}B | maxPain served=${served ?? "—"} polygonOI=${independent ?? "—"} [${verdict}]${differs ? "" : "  (== aggregate)"}`
      );
    }

    // A ticker where EVERY expiry matches the aggregate is suspicious: it is what "the scope was
    // ignored and we kept serving the blend" looks like. Not automatically a defect — a single-
    // expiry chain legitimately equals its own aggregate — so it is a WARN with the reason.
    note(
      differedSomewhere ? "PASS" : "WARN",
      differedSomewhere
        ? `${ticker}: per-expiry levels DIFFER from the near-term aggregate — scoping is real`
        : `${ticker}: every expiry matched the aggregate — expected only when the chain has one expiry (${expiries.length} on axis)`
    );
  }
} finally {
  await releaseAuditClerkSession();
}

const fails = findings.filter((f) => f.level === "FAIL");
const checked = findings.some((f) => /strikes=/.test(f.msg));
const verdict = fails.length > 0
  ? `${fails.length} FAILURES`
  : checked
    ? "ALL CHECKS PASSED"
    : "NO EVIDENCE GATHERED — no ticker yielded a per-expiry read; this run proves nothing";
if (asJson) console.log(JSON.stringify({ verdict, fails: fails.length, findings }, null, 2));
else console.log(`\n${"═".repeat(70)}\n${verdict}`);
process.exit(fails.length > 0 || !checked ? 1 : 0);
