/**
 * Pure verdict helpers for scripts/audit/helix-flows-ui-audit.cjs.
 *
 * WHY SPLIT OUT. The harness needs a live browser, a live session and a live page, so nothing
 * inside it can be unit-tested. The load-bearing part is not the clicking — it is deciding what a
 * given page state MEANS, and in particular refusing to call an unreadable page clean. Those
 * decisions are pure functions over a snapshot and belong where a test can reach them.
 *
 * THE RULE EVERY HELPER HERE HOLDS: an absent or unreadable measurement is HARNESS, never PASS and
 * never FAIL. A product verdict requires having actually seen the product. This is the trap
 * `meridian-interaction-audit.mjs` paid for — a probe returning `undefined` reported as clean,
 * which is indistinguishable from a page that rendered perfectly.
 */

/** A single bucket at or above this share is the §9.8 signature: the panel is not breaking the
 *  tape down at all, it is showing one bar. 95 rather than 98.8 so the check fires BEFORE the
 *  panel degrades all the way back to where it was. */
const DOMINANT_BUCKET_PCT = 95;

/**
 * Verdict on the Route Breakdown panel.
 *
 * This is the assertion that can confirm the §9.8 fix on PRODUCTION rather than from the diff:
 * before it, the live panel was a single `OTHER` bar at 98.8%. A healthy panel has more than one
 * bucket and no single bucket swallowing the tape.
 *
 * `UNREPORTED` is deliberately NOT exempt. It is expected to be the largest bucket (~70% live) and
 * that is fine — but if it ever reaches ~all of the tape, that means the rule-carrying feed has
 * stopped arriving, which is a real incident and exactly the kind of thing a panel showing one
 * grey bar would hide.
 */
function routeBucketVerdict(route) {
  if (!route) return { status: "FAIL", detail: "Route Breakdown panel did not render" };
  // Rendered but unlocatable is a HARNESS fault. Measured 2026-08-22: a `startsWith` locator found
  // Net Premium (no kicker) and missed Route Breakdown, whose container text begins with its
  // kicker "◇ execution" — and the harness reported a PRODUCT failure on a panel that had
  // rendered correctly. `inBodyText` is what separates the two questions.
  if (route.present !== true) {
    return route.inBodyText
      ? { status: "HARNESS", detail: "Route Breakdown rendered but the locator could not return it — harness fault, not a product verdict" }
      : { status: "FAIL", detail: "Route Breakdown panel did not render" };
  }
  const entries = Object.entries(route.buckets ?? {});
  if (entries.length === 0) {
    // The panel painted but no bucket could be parsed. That is unreadable, not wrong — and it
    // must not be reported as a passing panel.
    return { status: "HARNESS", detail: "Route Breakdown rendered but no bucket could be parsed" };
  }
  const dominant = entries.find(([, v]) => Number(v?.pct) >= DOMINANT_BUCKET_PCT);
  if (dominant) {
    return {
      status: "FAIL",
      detail: `Route Breakdown is one bar: ${dominant[0]} at ${dominant[1].pct}% (>= ${DOMINANT_BUCKET_PCT}%) — the §9.8 signature`,
    };
  }
  const shown = entries.map(([k, v]) => `${k} ${v.pct}%`).join(", ");
  return { status: "PASS", detail: `Route Breakdown shows ${entries.length} buckets: ${shown}` };
}

/**
 * Verdict on the freshness badge.
 *
 * Deliberately does NOT judge the AGE. Off-hours a tape is legitimately hours old and a STALE
 * badge is the correct render — a harness that failed on a stale weekend tape would be crying wolf
 * every Saturday, and the first thing anyone would do is stop running it. What it checks is that
 * an age is DISPLAYED at all: a desk that shows no age, or shows a permanently green light with no
 * number behind it, cannot be checked by a member either.
 */
function freshnessVerdict(ageText) {
  if (ageText == null) {
    return { status: "FAIL", detail: "no freshness age rendered — a member cannot tell how old the tape is" };
  }
  const m = String(ageText).match(/^(\d+)\s*(s|m|h)\s+ago$/);
  if (!m) return { status: "HARNESS", detail: `freshness text unparseable: "${ageText}"` };
  return { status: "PASS", detail: `freshness badge reads "${ageText}" (age is displayed; off-hours staleness is correct, not a fault)` };
}

/**
 * Roll up per-viewport results to one verdict.
 *
 * HARNESS WINS OVER PASS, and loses to FAIL. The ordering matters and is not arbitrary:
 *  - any real product failure is the headline, even if another viewport was unreadable;
 *  - otherwise, one unreadable viewport makes the whole run unproven — reporting PASS because the
 *    OTHER viewport was fine would let a half-blind run certify the product.
 */
/**
 * Verdict for a panel whose only requirement is "it rendered with real content".
 *
 * Same three-way split as routeBucketVerdict: absent is a product FAIL, rendered-but-unlocatable
 * is HARNESS, and located-but-empty is a FAIL only when the panel is not legitimately allowed to
 * be empty. `mayBeEmpty` exists because some HELIX panels return null BY DESIGN on a quiet tape
 * (ExpiryConcentration renders nothing when every horizon bucket is under its $50k floor), and a
 * harness that failed on that would be reporting correct behaviour as a defect every weekend.
 */
function panelVerdict(panel, name, { mayBeEmpty = false } = {}) {
  if (!panel) return { status: "FAIL", detail: `${name} panel did not render` };
  if (panel.present !== true) {
    return panel.inBodyText
      ? { status: "HARNESS", detail: `${name} rendered but the locator could not return it — harness fault` }
      : mayBeEmpty
        ? { status: "PASS", detail: `${name} absent — legitimate on a tape with nothing above its render floor` }
        : { status: "FAIL", detail: `${name} panel did not render` };
  }
  if (!panel.hasContent) return { status: "FAIL", detail: `${name} rendered but is empty` };
  return { status: "PASS", detail: `${name} rendered with content` };
}

function overallVerdict(results) {
  if (!Array.isArray(results) || results.length === 0) return "HARNESS";
  if (results.some((r) => r?.verdict === "FAIL")) return "FAIL";
  if (results.some((r) => r?.verdict !== "PASS")) return "HARNESS";
  return "PASS";
}

module.exports = { routeBucketVerdict, panelVerdict, freshnessVerdict, overallVerdict, DOMINANT_BUCKET_PCT };
