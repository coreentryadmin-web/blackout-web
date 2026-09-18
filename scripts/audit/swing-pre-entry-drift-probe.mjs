/**
 * SWING PRE-ENTRY DRIFT PROBE
 * =============================
 *
 * WHY THIS EXISTS (NEEDS_MEASUREMENT item 2, Night Hawk Swings outcome-driven improvement mandate)
 * ---------------------------------------------------------------------------------------------
 * Nobody had measured how much of a closed swing position's EVENTUAL favorable underlying move had
 * already happened BEFORE it was ever committed — i.e., how often discovery is "late," catching a
 * thesis only after a large chunk of the move already ran, versus catching it early with real room
 * still ahead.
 *
 * THE QUESTION THIS PROBE ANSWERS: for each real closed swing position, what fraction of its total
 * favorable underlying excursion (real discovery -> its own best post-entry close) had already
 * occurred BEFORE it was committed? A high drift fraction means discovery is systematically catching
 * moves late (chasing); a low one means positions are entered with real room still ahead of them.
 *
 * A GENUINE DATA-SHAPE GAP THIS PROBE HAD TO ROUTE AROUND (disclosed, not silently patched):
 * `GET /api/market/swing/record`'s `closedDeck.firstSeenAt` reads naturally as "when this ticker was
 * first discovered as a candidate" — but live-verified (5/5 sampled positions, byte-for-byte): it is
 * IDENTICAL to `committedAt` on every closed position checked. Tracing `closed-plays.ts` confirms why
 * — it is stamped at POSITION-ROW creation (i.e., at commit), not at the ticker's true first
 * observation as a raw candidate. The real, earlier discovery timestamp lives on a DIFFERENT,
 * admin-gated row: `GET /api/admin/swing/accumulation-export`'s `swing_candidate_accumulation` rows
 * carry their own `first_seen_at` (per the DB layer's own comment, "Never re-stamps first_seen_at")
 * plus a `promoted_position_id` that, when set, is the exact `closedDeck.positionId` of the position
 * it became. This probe therefore JOINS the two real routes on `positionId === promoted_position_id`
 * rather than trusting `closedDeck.firstSeenAt` at face value — the same "don't trust a field name,
 * verify against the real value" discipline this toolkit applies everywhere else. `--days` on the
 * accumulation-export fetch is intentionally set to `record`'s own days PLUS a lookback buffer, since
 * a position's real discovery can predate its own commit by more than a few days.
 *
 * WHAT'S REAL vs. APPROXIMATED
 * -----------------------------------------------------------------------------------------------
 * REAL (production data, never reimplemented):
 *   - `positionId`/`direction`/`committedAt`/`exitAt`/`ticker` from `GET /api/market/swing/record`'s
 *     `closedDeck` (member-tier route, same one every other swing audit tool in this toolkit reads).
 *   - `first_seen_at`/`promoted_position_id` from `GET /api/admin/swing/accumulation-export`
 *     (admin-gated — the exact route `swing-persistence-recall.mjs` already uses for a different
 *     question) — the REAL candidate-accumulation row's true discovery timestamp.
 *   - Underlying prices are REAL Polygon daily bars (`fetchStockDailyBars`), fetched per ticker over
 *     the exact real window each position needs (real first_seen_at through exitAt).
 *
 * DISCLOSED SIMPLIFICATION (the one this measurement rests on, stated up front like every other
 * tool in this toolkit that trades an unavailable exact instant for an honest, real proxy):
 *   - The position's REAL peak-favorable underlying close is not directly exposed by `closedDeck`
 *     (only `peakPremium`, an OPTION premium at an unknown date, is) — so the POST-entry leg here
 *     measures the underlying's OWN most-favorable daily close between `committedAt` and `exitAt`
 *     (`mostFavorableCloseInWindow`), the underlying-price analogue of the option's MFE, not the
 *     option's own peak-premium instant. This is a REAL, measured quantity (never fabricated) — it
 *     is simply a different (and for this question, more directly comparable) instrument than the
 *     option premium the rest of this toolkit's exit-focused tools use.
 *   - A closed position with NO matching `promoted_position_id` in the accumulation-export window
 *     (e.g. a Legacy-morning-confirm-promoted play, which never goes through the FLOW/STRUCTURE
 *     accumulation store at all — see #4843) is reported as `insufficient_data`, never silently
 *     dropped or backfilled with `closedDeck`'s own (proven-wrong) `firstSeenAt`.
 *
 * NOT MEASURED / A REAL LIMITATION (disclosed, not silently patched): `mostFavorableCloseInWindow`
 * only sees DAILY bars, so a position committed and exited on the same or an adjacent calendar day
 * often has no bar strictly inside [committedAt, exitAt] — the post-entry leg then reads null and
 * the chain reports `insufficient_data` rather than a fabricated zero. First live run (2026-09-12,
 * 90d, 30 real chains): 9/30 (30%) landed here — a real, disclosed daily-bar-granularity ceiling on
 * this measurement's coverage for short-hold positions, not a bug to silently work around.
 *
 * USAGE
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *   node --import tsx scripts/audit/swing-pre-entry-drift-probe.mjs [options]
 *
 * OPTIONS
 *   --days=N        lookback window for GET /api/market/swing/record (default 90)
 *   --lookback-buffer=N  extra days added to the accumulation-export fetch window, to catch
 *                        discovery moments that predate a position's own commit (default 30)
 *   --base=URL       base URL (default https://blackouttrades.com)
 *   --max-tickers=N  harness budget on real Polygon daily-bar fetches per run (default 100)
 *   --json           also print a machine-readable JSON summary at the end
 *
 * Read-only. Auth via `scripts/audit/lib/audit-auth-fetch.mjs` (cron-bearer first, Clerk fallback,
 * temp user released after) — the same helper used for both the member and admin routes. Secrets
 * from env only (POLYGON_API_KEY).
 */

if (!process.env.POLYGON_API_BASE || !/^https?:\/\//.test(process.env.POLYGON_API_BASE)) {
  process.env.POLYGON_API_BASE = "https://api.massive.com";
}

const SRC = new URL("../../src/", import.meta.url).pathname;

const args = process.argv.slice(2);
const flag = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : def;
};
const DAYS = Math.min(180, Math.max(1, Number(flag("days", "90")) || 90));
const LOOKBACK_BUFFER = Math.max(0, Number(flag("lookback-buffer", "30")) || 30);
const BASE = flag("base", "https://blackouttrades.com");
const MAX_TICKERS = Math.max(1, Number(flag("max-tickers", "100")) || 100);
const JSON_OUT = args.includes("json") || args.includes("--json");

const { fetchAuditJson, releaseAuditClerkSession } = await import("./lib/audit-auth-fetch.mjs");
const { fetchStockDailyBars } = await import(`${SRC}lib/providers/polygon.ts`);
const {
  signAlignedMovePct,
  classifyPreEntryDrift,
  mostFavorableCloseInWindow,
  closeAtOrBefore,
  findRealFirstSeenAt,
} = await import("./lib/swing-pre-entry-drift-eval.mjs");

const INDEX_INSTRUMENTS = new Set(["SPX", "SPXW", "VIX", "VIXW", "NDX", "RUT", "XSP", "VVIX", "DJX"]);

function ymd(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

async function main() {
  const res = await fetchAuditJson(BASE, `/api/market/swing/record?days=${DAYS}`);
  if (!res.ok || !res.json?.closedDeck) {
    const out = { ok: false, insufficient_data: true, status: res.status, via: res.via };
    console.log(JSON_OUT ? JSON.stringify(out, null, 2) : `INSUFFICIENT DATA — GET /api/market/swing/record?days=${DAYS} -> ${res.status} via=${res.via ?? "none"}`);
    await releaseAuditClerkSession();
    process.exitCode = 1;
    return;
  }

  const rows = (res.json.closedDeck ?? []).map((c) => ({
    positionId: c.positionId ?? null,
    ticker: c.ticker,
    direction: c.direction === "SHORT" ? "SHORT" : "LONG",
    committedAt: c.committedAt ?? null,
    exitAt: c.exitAt ?? null,
  }));

  console.log(`\n=== SWING PRE-ENTRY DRIFT PROBE (${DAYS}d window, ${rows.length} closed chains) ===`);

  // Real discovery timestamps live on a DIFFERENT, admin-gated route (see header) — fetch a wider
  // window than `record`'s own DAYS since a position's true discovery can predate its own commit.
  const accumRes = await fetchAuditJson(BASE, `/api/admin/swing/accumulation-export?days=${DAYS + LOOKBACK_BUFFER}`);
  if (!accumRes.ok || !accumRes.json?.rows) {
    const out = { ok: false, insufficient_data: true, status: accumRes.status, via: accumRes.via };
    console.log(JSON_OUT ? JSON.stringify(out, null, 2) : `INSUFFICIENT DATA — GET /api/admin/swing/accumulation-export -> ${accumRes.status} via=${accumRes.via ?? "none"} (admin auth required)`);
    await releaseAuditClerkSession();
    process.exitCode = 1;
    return;
  }
  const accumRows = accumRes.json.rows;
  console.log(`  ${accumRows.length} accumulation-export rows fetched (${accumRows.filter((r) => r.promoted_position_id != null).length} promoted)`);

  const withRealFirstSeen = rows.map((r) => ({ ...r, firstSeenAt: r.positionId != null ? findRealFirstSeenAt(accumRows, r.positionId) : null }));
  const withTimestamps = withRealFirstSeen.filter((r) => r.firstSeenAt && r.committedAt && r.exitAt);
  const missingTimestamps = withRealFirstSeen.length - withTimestamps.length;
  console.log(`  ${withTimestamps.length}/${rows.length} chains have a REAL matching accumulation-export discovery timestamp (${missingTimestamps} with no match — e.g. Legacy-promoted plays that never went through FLOW/STRUCTURE accumulation — reported as insufficient_data, never dropped silently)`);

  const budgeted = withTimestamps.slice(0, MAX_TICKERS);
  const skippedForBudget = withTimestamps.length - budgeted.length;
  if (skippedForBudget > 0) {
    console.log(`  ${skippedForBudget} chain(s) SKIPPED (BUDGET) beyond --max-tickers=${MAX_TICKERS} — never silently dropped, named here.`);
  }

  const results = [];
  for (const row of budgeted) {
    const firstSeenMs = Date.parse(row.firstSeenAt);
    const committedMs = Date.parse(row.committedAt);
    const exitMs = Date.parse(row.exitAt);
    if (!Number.isFinite(firstSeenMs) || !Number.isFinite(committedMs) || !Number.isFinite(exitMs)) {
      results.push({ ...row, error: "unparseable timestamp" });
      continue;
    }
    if (committedMs <= firstSeenMs || exitMs <= committedMs) {
      results.push({ ...row, error: "non-chronological timestamps (firstSeen/commit/exit out of order)" });
      continue;
    }

    let bars;
    try {
      bars = INDEX_INSTRUMENTS.has(row.ticker)
        ? []
        : await fetchStockDailyBars(row.ticker, ymd(firstSeenMs - 3 * 86_400_000), ymd(exitMs + 86_400_000));
    } catch (e) {
      results.push({ ...row, error: e instanceof Error ? e.message : String(e) });
      continue;
    }
    if (!bars?.length) {
      results.push({ ...row, error: "no bars returned" });
      continue;
    }

    const priceAtFirstSeen = closeAtOrBefore(bars, firstSeenMs);
    const priceAtCommit = closeAtOrBefore(bars, committedMs);
    const postEntryBestClose = mostFavorableCloseInWindow(bars, { fromMs: committedMs, toMs: exitMs, direction: row.direction });

    const preEntryMovePct = signAlignedMovePct({ fromPrice: priceAtFirstSeen, toPrice: priceAtCommit, direction: row.direction });
    const postEntryMovePct = signAlignedMovePct({ fromPrice: priceAtCommit, toPrice: postEntryBestClose, direction: row.direction });
    const { bucket, driftFraction } = classifyPreEntryDrift({ preEntryMovePct, postEntryMovePct });

    results.push({ ...row, preEntryMovePct, postEntryMovePct, bucket, driftFraction });
  }

  const tally = {};
  for (const r of results) {
    const key = r.error ? "error" : r.bucket;
    tally[key] = (tally[key] ?? 0) + 1;
  }

  console.log(`\n${"─".repeat(100)}`);
  console.log(`  TICKER  DIR    PRE-ENTRY%   POST-ENTRY%   BUCKET                  DRIFT%   NOTE`);
  console.log("─".repeat(100));
  for (const r of results) {
    const pre = r.preEntryMovePct != null ? `${r.preEntryMovePct >= 0 ? "+" : ""}${r.preEntryMovePct.toFixed(2)}` : "—";
    const post = r.postEntryMovePct != null ? `${r.postEntryMovePct >= 0 ? "+" : ""}${r.postEntryMovePct.toFixed(2)}` : "—";
    const drift = r.driftFraction != null ? (r.driftFraction * 100).toFixed(1) : "—";
    console.log(
      `  ${(r.ticker ?? "?").padEnd(8)}${(r.direction ?? "").padEnd(7)}${pre.padEnd(13)}${post.padEnd(14)}${(r.bucket ?? "error").padEnd(24)}${drift.padEnd(9)}${r.error ?? ""}`
    );
  }

  const measurable = results.filter((r) => r.bucket === "measurable");
  const meanDrift = measurable.length
    ? measurable.reduce((s, r) => s + r.driftFraction, 0) / measurable.length
    : null;

  console.log(`\n${"═".repeat(100)}`);
  console.log("  SUMMARY");
  console.log("═".repeat(100));
  console.log(`  Chains attempted:        ${results.length}`);
  for (const [k, v] of Object.entries(tally)) console.log(`  ${k.padEnd(24)} ${v}`);
  if (measurable.length) {
    console.log(`\n  Mean drift fraction (measurable only, n=${measurable.length}): ${(meanDrift * 100).toFixed(1)}%`);
    console.log(`  (fraction of the eventual favorable underlying move that had ALREADY happened before commit)`);
  } else {
    console.log(`\n  No chain fell in the "measurable" bucket this run — INSUFFICIENT DATA for a mean, not a zero finding.`);
  }
  console.log("═".repeat(100));

  if (JSON_OUT) {
    console.log(JSON.stringify({
      ok: true,
      days: DAYS,
      population: rows.length,
      withTimestamps: withTimestamps.length,
      missingTimestamps,
      skippedForBudget,
      tally,
      meanDriftFraction: meanDrift,
      results,
    }, null, 2));
  } else {
    console.log(`\nNo gate/engine changed by this script — evidence only, per the standing "measure before touching a threshold" discipline.`);
  }

  await releaseAuditClerkSession();
}

main().catch(async (e) => {
  console.error("FATAL", e);
  await releaseAuditClerkSession().catch(() => {});
  process.exit(1);
});
