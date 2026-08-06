#!/usr/bin/env node
/**
 * OUTCOME-GRADING CROSS-CHECK — turns the comment-only invariant on feature-store.ts's
 * `labelFromPlanOutcome` ("kept byte-identical to record.ts's `isZeroDteWin` … so the learning
 * store can never disagree with the member-facing record") into a TESTED one against REAL
 * historical graded rows. See docs/audit/OUTCOME-GRADING-SPEC.md for the full grader inventory
 * this is one check out of.
 *
 * THE TWO GRADERS UNDER TEST (both imported LIVE from production — never reimplemented):
 *   - feature-store.ts `labelFromPlanOutcome(outcome, pnlPct)` — reads the raw MID (mechanical,
 *     gradePlanFromBars) `plan_outcome`/`plan_pnl_pct` DB columns (db.ts fetchGradedFeatureVectorRows
 *     selects those two columns directly, no entry_context join).
 *   - record.ts `isZeroDteWin` / `isGradedZeroDteRow` — read the OFFICIAL WS-10 conservative-
 *     EXECUTABLE lane (`entry_context.executable`, via officialPlanPnlPct/officialPlanOutcome),
 *     falling back to the same mid columns ONLY for legacy (pre-WS10) rows.
 * WS-10's single-walk executable grade is normally <= its mid twin (paid-the-ask entry, sold-the-bid
 * exit, earlier-triggered stop), and WS-11's reconstructed TRIM-SCALE path can go the OTHER way (a
 * partial-profit leg banked before the runner stopped can make the official number BETTER than a
 * single mid walk that only checks the final exit) — either direction can flip the win/loss SIGN
 * relative to the mid grade, so feature-store's mid-based label and record's official-based label
 * CAN disagree in both directions. This script measures how often that actually happens on real
 * ledger rows.
 *
 * DATA SOURCE. The raw mid columns are not exposed by any live route directly, BUT scan.ts's WS-10
 * stamp writes them redundantly INSIDE the executable blob (`mid_plan_outcome`/`mid_plan_pnl_pct` —
 * see plan.ts/scan.ts `executableBlob`), and `entry_context` (which carries that blob) is served
 * verbatim per play by the already-live `GET /api/market/zerodte/record` route (confirmed reachable
 * from this sandbox without raw DB access — see docs/audit/INTENTIONAL-DESIGN.md item #1, same
 * route). So this audit is LIVE + read-only: authenticate once as a temp admin/premium Clerk user
 * (scripts/audit/lib/audit-auth-fetch.mjs — cron-bearer first, Clerk fallback, deleted after), fetch
 * a window of real graded rows, and recompute both labels per row via
 * scripts/audit/lib/grading-agreement-eval.mjs (pure, unit-tested).
 *
 * Pass --ledger=<path.json> to run OFFLINE against an already-exported `/record` payload (or its
 * `.plays` array) instead of hitting the live app — useful for a reproducible re-run on a captured
 * snapshot. With neither a reachable live app NOR --ledger it prints INSUFFICIENT DATA — it never
 * fabricates a result.
 *
 * USAGE
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *   node --import tsx scripts/audit/outcome-grading-audit.mjs [--days=90] [--base=https://blackouttrades.com]
 *        [--ledger=<path.json>] [--json]
 *
 * Secrets from env only (CLERK_SECRET_KEY / CRON_SECRET, via audit-auth-fetch.mjs). Never prints
 * secrets. Read-only: does not write to the DB or the board; the one temp Clerk user it may mint is
 * always released.
 */
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";
import { evaluatePlayAgreement } from "./lib/grading-agreement-eval.mjs";

const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);
const BASE = String(argv.base ?? process.env.AUDIT_APP_URL ?? "https://blackouttrades.com").replace(/\/$/, "");
const DAYS = Math.max(1, Math.min(90, Number(argv.days ?? 90) || 90));
const JSON_OUT = argv.json === true || argv.json === "true";

function insufficient(reason) {
  if (JSON_OUT) {
    console.log(JSON.stringify({ ok: false, insufficient_data: true, reason }, null, 2));
  } else {
    console.log(`\n=== outcome-grading-audit — INSUFFICIENT DATA ===`);
    console.log(reason);
    console.log(
      "\nProvide EITHER a reachable live app (CLERK_SECRET_KEY + NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,\n" +
        "or a valid CRON_SECRET) so this script can hit GET /api/market/zerodte/record itself, OR pass\n" +
        "--ledger=<path.json> with an exported /record payload (or its .plays array) captured elsewhere."
    );
  }
}

async function readJson(path) {
  const fs = await import("node:fs/promises");
  const txt = await fs.readFile(path, "utf8");
  return JSON.parse(txt);
}

async function loadPlays() {
  if (typeof argv.ledger === "string") {
    const parsed = await readJson(argv.ledger).catch((e) => {
      console.error(`Could not read --ledger=${argv.ledger}: ${e?.message ?? e}`);
      process.exit(2);
    });
    const plays = Array.isArray(parsed) ? parsed : (parsed?.plays ?? []);
    return { plays, source: `--ledger=${argv.ledger}` };
  }
  const res = await fetchAuditJson(BASE, `/api/market/zerodte/record?days=${DAYS}`);
  if (!res.ok || !res.json) {
    return { plays: null, source: null, fetchError: `GET /api/market/zerodte/record?days=${DAYS} -> ${res.status} (via=${res.via ?? "none"})` };
  }
  const plays = Array.isArray(res.json?.plays) ? res.json.plays : [];
  return { plays, source: `${BASE}/api/market/zerodte/record?days=${DAYS} (via=${res.via})` };
}

async function main() {
  // The REAL production predicate — imported live, never reimplemented, so this audit measures
  // the ACTUAL shipped feature-store.ts function, not a copy that could silently drift from it.
  const { labelFromPlanOutcome } = await import(new URL("../../src/lib/zerodte/feature-store.ts", import.meta.url).pathname);

  const { plays, source, fetchError } = await loadPlays();
  if (plays == null) {
    insufficient(
      `Could not reach the live app to fetch graded rows (${fetchError}). Raw Postgres is blocked from\n` +
        `this sandbox, so this is the only live path — see the CLAUDE.md "Environment realities" note.`
    );
    await releaseAuditClerkSession();
    return;
  }
  if (plays.length === 0) {
    insufficient(`${source} returned zero plays — nothing to cross-check (try a larger --days window).`);
    await releaseAuditClerkSession();
    return;
  }

  const results = plays.map((p) => evaluatePlayAgreement(p, labelFromPlanOutcome));
  const bothGraded = results.filter((r) => r.both_graded);
  const disagreements = bothGraded.filter((r) => r.agree === false);
  const legacyN = results.filter((r) => r.mid_source === "legacy_fallback").length;
  const ws10N = results.filter((r) => r.mid_source === "executable_blob").length;
  // Coverage mismatch: one grader saw evidence, the other didn't — not a disagreement (neither
  // asserts a conflicting label), but worth surfacing (e.g. feature-store's own SQL population vs
  // record's official-graded population can differ at the margins).
  const coverageMismatch = results.filter(
    (r) => !r.both_graded && (r.feature_store_label != null || r.record_label != null)
  );

  const agreementRate = bothGraded.length ? (bothGraded.length - disagreements.length) / bothGraded.length : null;

  const payload = {
    ok: true,
    source,
    plays_scanned: results.length,
    legacy_rows: legacyN, // mid === official by construction — invariant trivially holds
    ws10_rows: ws10N, // mid CAN differ from official — the rows that actually test the invariant
    both_graders_evidence: bothGraded.length,
    disagreements: disagreements.length,
    agreement_rate: agreementRate,
    coverage_mismatch: coverageMismatch.length,
    disagreement_detail: disagreements,
    coverage_mismatch_detail: coverageMismatch.slice(0, 20),
  };

  if (JSON_OUT) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`\n=== OUTCOME-GRADING CROSS-CHECK (feature-store.ts labelFromPlanOutcome vs record.ts isZeroDteWin) ===`);
    console.log(`source: ${source}`);
    console.log(`plays scanned: ${results.length}  (legacy/pre-WS10: ${legacyN} · WS-10 executable-graded: ${ws10N})`);
    console.log(`both graders had evidence on: ${bothGraded.length}`);
    console.log(
      `AGREEMENT: ${bothGraded.length - disagreements.length}/${bothGraded.length}` +
        (agreementRate != null ? `  (${(agreementRate * 100).toFixed(1)}%)` : "")
    );
    console.log(`DISAGREEMENTS: ${disagreements.length}`);
    for (const d of disagreements) {
      console.log(
        `  · ${d.session_date} ${d.ticker}: feature-store=${d.feature_store_label} (mid ${d.mid_outcome} ${d.mid_pnl_pct}%) ` +
          `vs record=${d.record_label} (official ${d.official_outcome} ${d.official_pnl_pct}%)`
      );
    }
    if (coverageMismatch.length) {
      console.log(`\ncoverage mismatches (one grader had no label, the other did) — not a disagreement: ${coverageMismatch.length}`);
    }
    console.log(
      disagreements.length === 0
        ? `\nVerdict: the invariant HOLDS on this sample — a real, reportable good result (${bothGraded.length} rows checked, 0 label conflicts).`
        : `\nVerdict: the invariant is BROKEN on ${disagreements.length} real row(s) — feature-store.ts's "can never disagree" comment does not hold once a row carries a WS-10 executable grade. See docs/audit/OUTCOME-GRADING-SPEC.md.`
    );
  }
  await releaseAuditClerkSession();
  process.exit(disagreements.length > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await releaseAuditClerkSession().catch(() => {});
  process.exit(2);
});
