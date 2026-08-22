/**
 * MERIDIAN DATA-INTEGRITY INVARIANTS, checked against the LIVE payload.
 *
 * Every defect these encode was found by hand on production on 2026-08-21, and not one of them
 * could have been caught by a unit test. Unit tests check the code that is running; these check
 * the SHAPE OF WHAT PRODUCTION ACTUALLY SERVED — which also fails when a cache serves a pre-deploy
 * payload, when an upstream provider changes its encoding, or when a field quietly stops being
 * written. Each invariant below cites the fix that made it true, so a regression names itself.
 *
 * Pure and total: every predicate takes a parsed payload and returns violations. No IO, no throw.
 * A malformed or absent payload yields NO violations — absence of evidence is not evidence of a
 * defect, and a checker that reports failures on a payload it could not read is worse than one
 * that says nothing.
 */

/** Entities that reached a member's screen verbatim. Numeric and named forms both. */
const HTML_ENTITY = /&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9a-f]+);/i;

/** YYYY-MM-DD or nothing. */
function ymd(v) {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

function walk(node, path, visit) {
  if (node == null) return;
  if (typeof node === "string") return visit(node, path);
  if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${path}[${i}]`, visit));
  if (typeof node === "object") {
    for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`, visit);
  }
}

/**
 * #2608 — the earnings report printed `Will S&amp;P 500` and `Wall Street&#39;s` verbatim.
 * Nine strings across six fields on one event. The decoder existed and Meridian was not using it.
 */
export function entityViolations(event) {
  const out = [];
  walk(event?.enrichment, "enrichment", (s, p) => {
    if (HTML_ENTITY.test(s)) out.push({ rule: "no_raw_entities", path: p, sample: s.slice(0, 90) });
  });
  return out;
}

/**
 * #2613 — `expected_move_pct: 0.1` under `source: "chain_iv"` for a print three days out, quoted
 * from an expiry that had already died. A quote may only describe the print if it spans it.
 */
export function expectedMoveScopeViolations(event) {
  const intel = event?.intel;
  if (!intel) return [];
  const out = [];
  const printDate = ymd(event?.date) ?? ymd(intel?.earnings_date) ?? ymd(event?.event?.date);
  const vecExpiry = ymd(intel?.vector?.expiry);
  const move = intel?.vector?.move_pct;
  // The Vector cone must never be published for a print its expiry cannot reach.
  if (printDate && vecExpiry && move != null && vecExpiry < printDate) {
    out.push({
      rule: "vector_quote_predates_print",
      path: "intel.vector",
      sample: `move_pct ${move} from ${vecExpiry}, print ${printDate}`,
    });
  }
  return out;
}

/**
 * #2614 — "Realized -4.41% vs ~25.6% implied (0.17×)" compared an UPCOMING print's implied to a
 * reaction from the previous quarter. A ratio or a verdict asserts the two sides are commensurable.
 */
export function expectedVsRealizedViolations(event) {
  const evr = event?.enrichment?.expected_vs_realized;
  if (!evr) return [];
  const out = [];
  const priorImplied = event?.enrichment?.print_history?.[0]?.expected_move_pct;
  const claims = evr.ratio != null || (evr.verdict && evr.verdict !== "unknown");
  if (claims && priorImplied == null) {
    out.push({
      rule: "evr_compares_across_events",
      path: "enrichment.expected_vs_realized",
      sample: `ratio ${evr.ratio} verdict ${evr.verdict} with no captured per-print implied`,
    });
  }
  // Withholding the ratio was not sufficient. `MeridianEarningsTabs` rebuilt the pairing from the
  // pack's forward implied and rendered it under the reaction to a print months earlier, so the
  // block must not CARRY a number that does not belong to the print it describes. An implied on a
  // cross-event block is the raw material for the next such banner.
  if (evr.same_event === false && evr.expected_move_pct != null) {
    out.push({
      rule: "evr_carries_foreign_implied",
      path: "enrichment.expected_vs_realized.expected_move_pct",
      sample: `expected_move_pct ${evr.expected_move_pct} on a block flagged same_event=false`,
    });
  }
  // A ratio or verdict may only ride on a block that states the two sides are the same print.
  // `same_event === false` only — an ABSENT flag is an older payload, not a claim of difference,
  // and firing on it would light up every event during a deploy window.
  if (claims && evr.same_event === false) {
    out.push({
      rule: "evr_claims_without_same_event",
      path: "enrichment.expected_vs_realized",
      sample: `ratio ${evr.ratio} verdict ${evr.verdict} with same_event ${evr.same_event}`,
    });
  }
  return out;
}

/**
 * #2611 — the display band is remapped when the gamma walls invert, and the raw strikes are the
 * only way a reader can see what was actually measured. Inverted without them is unreadable.
 */
export function wallInversionViolations(event) {
  const th = event?.intel?.thermal;
  if (!th || th.walls_inverted !== true) return [];
  const missing = ["gamma_call_wall", "gamma_put_wall"].filter((k) => th[k] == null);
  return missing.length
    ? [{ rule: "inverted_walls_without_raw_strikes", path: "intel.thermal", sample: `missing ${missing.join(", ")}` }]
    : [];
}

/**
 * #2585 — one `expiry_scope` badge covered eleven fields that did not share a scope. When the
 * payload claims a scope it must also say which levels it applies to.
 */
export function levelScopeViolations(event) {
  const th = event?.intel?.thermal;
  if (!th || th.available === false || th.expiry_scope == null) return [];
  return th.level_scopes == null
    ? [{ rule: "expiry_scope_without_level_scopes", path: "intel.thermal", sample: `expiry_scope ${th.expiry_scope}` }]
    : [];
}

/**
 * BMO/AMC ANCHORING — getting this wrong INVERTS the number rather than degrading it.
 *
 * A post-close print is digested by the NEXT session, and its move is mostly the overnight gap.
 * Measuring it open→close on the reacting session drops that gap entirely, so a large reaction
 * reads as a small one — and the sign can flip when the gap and the intraday move disagree.
 *
 * VERIFIED against independent price data, GRRR printing 2026-03-02 16:15 ET (AMC):
 *   03-02 close 12.46 (print day) -> 03-03 close 11.49  =  -7.78%
 *   served: reaction_pct -7.78, basis "amc_next_session", measure "prior_close_to_close"  ✓
 * Live distribution across 95 rows: 84 bmo_session, 10 amc_next_session, 1 assumed — and all 10
 * AMC rows carried `prior_close_to_close`, none carried `session_open_to_close`.
 *
 * So this rule pins a property the product ALREADY satisfies. That is deliberate: it is cheap to
 * regress silently (one measure swap), the failure is invisible in the payload's shape, and the
 * number stays plausible while meaning something else.
 */
export function reactionAnchorViolations(event) {
  const rows = event?.enrichment?.print_history;
  if (!Array.isArray(rows)) return [];
  const out = [];
  rows.forEach((p, i) => {
    if (p?.reaction_basis !== "amc_next_session") return;
    // Only flag the measure that actively drops the gap. An absent measure is unknown, not wrong.
    if (p.reaction_measure === "session_open_to_close") {
      out.push({
        rule: "amc_reaction_measured_open_to_close",
        path: `enrichment.print_history[${i}]`,
        sample: `${p.report_date ?? "?"} ${p.report_time_et ?? "?"} — AMC print measured open->close, dropping the overnight gap`,
      });
    }
  });
  return out;
}

const RULES = [
  entityViolations,
  expectedMoveScopeViolations,
  expectedVsRealizedViolations,
  wallInversionViolations,
  levelScopeViolations,
  reactionAnchorViolations,
];

/** Every violation on one event payload, tagged with the ticker for a readable report. */
export function eventViolations(event, ticker) {
  return RULES.flatMap((fn) => fn(event)).map((v) => ({ ...v, ticker: ticker ?? null }));
}

/** Distinct rules that fired, for a one-line summary. */
export function summarize(violations) {
  const byRule = new Map();
  for (const v of violations) byRule.set(v.rule, (byRule.get(v.rule) ?? 0) + 1);
  return [...byRule].sort((a, b) => b[1] - a[1]);
}
