// Pure helper for swing-e2e-healthcheck.mjs Stage G (GRADING/RECORD).
//
// WHY THIS EXISTS: Stage G fetched `/api/market/nighthawk/record` — the Night Hawk LEGACY
// digest's own outcome endpoint (`nighthawk_play_outcomes` joined to `nighthawk_editions`,
// entry-range/next-day-open-close/morning-verdict concepts that only exist for Legacy's
// next-day digest plays), not swing's own ledger at all. Its flat response shape
// (`total_resolved`/`win_rate_pct`/`segments.current`/`by_conviction`) happens to parse
// without erroring against the OLD stage-G code below, so the stage always reported GREEN
// with real-looking numbers — just Legacy's numbers, not swing's. Live-caught 2026-09-13:
// the SWING lane's own healthcheck reported "68 resolved WR 66.7%" while the real swing
// ledger (`GET /api/market/swing/record`, summary block) reported "21 resolved WR 23.8%" —
// a different endpoint, a different product, a different number, silently substituted.
// Same class of bug as swing-healthcheck-mark-eval.mjs's Stage F fix (#1191): a healthcheck
// stage reading the wrong shape since it was built, extracted to a pure/testable module the
// same way.
//
// Swing's real shape (`GET /api/market/swing/record`) nests everything under `summary`:
// `{ chains, resolved_chains, wins, losses, breakevens, opens, win_rate_pct,
//   avg_compounded_return_pct, low_n }` — see record.ts's own `buildSwingRecordSummary` for
// the field definitions. `wins + losses === resolved_chains` by construction (a breakeven
// leg is a SUBSET of losses, not a third bucket — record.ts's own documented,
// intentionally-conservative scoring rule), so that invariant is worth asserting here too.

/**
 * Evaluate Stage G checks from a real swing record response.
 *
 * @param {any} record — the parsed JSON body of `GET /api/market/swing/record`.
 * @returns {Array<{ status: "GREEN"|"AMBER", label: string, detail: string }>}
 */
export function evaluateSwingGradingRecord(record) {
  if (!record) {
    return [{ status: "AMBER", label: "record endpoint", detail: "no record response — grading check skipped" }];
  }
  if (record.available === false) {
    return [
      {
        status: "AMBER",
        label: "record unavailable",
        detail: `available=false — ${record.error ?? "temporarily unavailable"}`,
      },
    ];
  }
  const summary = record.summary;
  if (!summary || typeof summary !== "object") {
    return [
      {
        status: "AMBER",
        label: "no summary block",
        detail: "record response carries no summary — cannot grade (wrong endpoint/shape?)",
      },
    ];
  }

  const checks = [];
  const { chains, resolved_chains, wins, losses, breakevens, opens, win_rate_pct, low_n } = summary;

  if (resolved_chains > 0) {
    checks.push({
      status: "GREEN",
      label: "graded positions",
      detail: `${resolved_chains} resolved chain(s) of ${chains} · WR ${win_rate_pct}% · wins=${wins} losses=${losses} breakevens=${breakevens} opens=${opens}`,
    });
  } else {
    checks.push({
      status: "AMBER",
      label: "no graded positions",
      detail: "0 resolved chains in the record window — the swing ladder has not graduated yet",
    });
  }

  if (resolved_chains > 0 && wins + losses !== resolved_chains) {
    checks.push({
      status: "AMBER",
      label: "wins+losses mismatch",
      detail: `wins(${wins})+losses(${losses}) != resolved_chains(${resolved_chains}) — check the summary's own accounting`,
    });
  }

  if (resolved_chains > 0) {
    checks.push({
      status: low_n ? "AMBER" : "GREEN",
      label: "sample size",
      detail: `low_n=${low_n} (${resolved_chains} resolved chains)`,
    });
  }

  return checks;
}
