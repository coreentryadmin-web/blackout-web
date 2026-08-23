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
  /**
   * SANITY-CHECK THE PARSE BEFORE JUDGING THE PRODUCT.
   *
   * Shares of one panel must sum to ~100. When they do not, the parse is broken and NOTHING about
   * the panel has actually been measured. This exists because the harness once returned PASS with
   * every bucket at 0% — a regex backtracking bug — against a panel the screenshot showed at
   * OTHER 100%. No bucket exceeded the dominance threshold, so the check found nothing to fail on,
   * and a broken instrument certified a broken panel as healthy.
   */
  const sum = entries.reduce((t, [, v]) => t + (Number(v?.pct) || 0), 0);
  if (sum < 50 || sum > 150) {
    return {
      status: "HARNESS",
      detail: `Route Breakdown shares sum to ${sum}% across ${entries.length} buckets — the parse is broken, nothing was measured`,
    };
  }

  /**
   * DOMINANCE IS TWO DIFFERENT FACTS, and conflating them makes this check cry wolf.
   *
   * The threshold was written pre-fix, when one bucket at ~100% could only mean the §9.8
   * vocabulary bug — everything falling to `OTHER` for want of a word. After the fix it fired
   * again on the very first post-deploy run, this time on `UNREPORTED at 95%`, and reported it as
   * "the §9.8 signature". That was wrong: §9.8 is fixed, and 95% is the honest number.
   *
   * WHY 95% IS HONEST. The panel's `pct` is a share of PREMIUM, not of prints. The routeless
   * SPX/SPY feed (HELIX-MAP §4A) carries 92.1% of all premium on the tape while being ~70-79% of
   * rows, so a premium-weighted `UNREPORTED` near 95% is exactly what a correct panel shows. A
   * harness that fails on that is failing on reality, and would be switched off inside a week.
   *
   * So the two cases are separated by WHICH bucket dominates:
   *   - `OTHER` dominating  -> a vocabulary regression. Rules exist and we have no word for them.
   *     That is a code defect and stays a FAIL.
   *   - `UNREPORTED` dominating -> prints carry no rule at all. Honest, and a product/data
   *     condition rather than a regression — UNLESS it is the ONLY bucket, which would mean the
   *     rule-carrying feed has stopped arriving entirely. That stays a FAIL.
   */
  const dominant = entries.find(([, v]) => Number(v?.pct) >= DOMINANT_BUCKET_PCT);
  if (dominant) {
    const [name, v] = dominant;
    if (name === "UNREPORTED") {
      if (entries.length === 1) {
        return {
          status: "FAIL",
          detail: `Route Breakdown is UNREPORTED and nothing else (${v.pct}%) — the rule-carrying feed has stopped arriving`,
        };
      }
      return {
        status: "PASS",
        detail:
          `Route Breakdown led by UNREPORTED at ${v.pct}% of PREMIUM, with ${entries.length - 1} other bucket(s) present ` +
          `— expected: the routeless index feed carries ~92% of tape premium. Not a regression`,
      };
    }
    return {
      status: "FAIL",
      detail: `Route Breakdown is one bar: ${name} at ${v.pct}% (>= ${DOMINANT_BUCKET_PCT}%)` +
        (name === "OTHER" ? " — the §9.8 signature: rules exist that we have no word for" : ""),
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
  // NOT_EXERCISED is not a harness fault and must not poison the rollup: a market-closed page
  // legitimately cannot populate the split-flow radar, and reporting HARNESS for that would make
  // every off-hours run look broken. It is surfaced per-check instead, where it is actionable.
  if (results.some((r) => r?.verdict !== "PASS" && r?.verdict !== "NOT_EXERCISED")) return "HARNESS";
  return results.some((r) => r?.verdict === "NOT_EXERCISED") ? "PASS (partial)" : "PASS";
}


// ── Surfaces shipped 2026-08-23, added so Monday's manual checklist becomes assertions ──────────
//
// Every one of these can be legitimately UNPOPULATED off-hours, so each returns NOT_EXERCISED
// rather than FAIL when its population is absent. That distinction is the whole point: a harness
// that reports FAIL on a market-closed page teaches its reader to skip the report, which this repo
// already paid for once in the Vector lane.

/**
 * #2689 — the NEW-positioning badge. Three criteria, all from the PR's own acceptance list.
 *
 * (1) A badge on a row whose OI column reads "—" is FABRICATION: that row was never examined.
 * (2) The ratio in "NEW xN" must agree with that row's OWN OI/Prem/Fill columns — badge and
 *     columns are derived from the same three numbers and must agree ON SCREEN. The tolerance is
 *     what DISPLAY ROUNDING can produce (Prem shows "$1.4M", Fill "2.75"), not a fudge factor.
 * (3) A badge collapsed into the "+N" overflow is invisible, which for this feature is the same as
 *     absent — the desktop tape renders only `signals.slice(0, 3)`.
 */
const NEW_RATIO_TOLERANCE = 0.25;

function newBadgeVerdict(rows) {
  if (!Array.isArray(rows)) return { status: "HARNESS", detail: "tape rows were never read" };
  const badged = rows.filter((r) => r && typeof r.newLabel === "string" && r.newLabel);
  if (!badged.length) {
    return {
      status: "NOT_EXERCISED",
      detail: `no NEW badge in ${rows.length} rendered rows — the badge only fires on prints that PROVE new positioning, and a given page may hold none`,
    };
  }
  const fabricated = badged.filter((r) => r.oi == null || r.oi === "" || /^[—-]$/.test(String(r.oi).trim()));
  if (fabricated.length) {
    return {
      status: "FAIL",
      detail: `${fabricated.length} of ${badged.length} NEW badges sit on a row whose OI reads "—" — that row was never examined, so the badge is fabricated`,
    };
  }
  let checked = 0;
  const mismatches = [];
  for (const r of badged) {
    const m = /^NEW\s+([\d.]+)×$/.exec(r.newLabel);
    if (!m) continue; // a bare "NEW" carries no ratio to cross-check
    const prem = parseCompactNumber(r.prem);
    const fill = parseCompactNumber(r.fill);
    const oi = parseCompactNumber(r.oi);
    if (prem == null || fill == null || oi == null || oi <= 0 || fill <= 0) continue;
    checked++;
    const shown = Number(m[1]);
    const derived = prem / (fill * 100) / oi;
    if (!(Math.abs(derived - shown) / shown < NEW_RATIO_TOLERANCE)) {
      mismatches.push(`${r.newLabel} vs oi=${r.oi} prem=${r.prem} fill=${r.fill} (derived ${derived.toFixed(1)}x)`);
    }
  }
  if (mismatches.length) {
    return {
      status: "FAIL",
      detail: `${mismatches.length} of ${checked} NEW ratios disagree with the row's own columns: ${mismatches.slice(0, 3).join(" · ")}`,
    };
  }
  return {
    status: "PASS",
    detail: `${badged.length} NEW badge(s), 0 on an unexamined row, ${checked} ratio(s) agreeing with their own OI/Prem/Fill columns`,
  };
}

/** "$1.4M" / "1.5K" / "884" / "2.75" -> a number. Null when it is not a number at all (e.g. "—"). */
function parseCompactNumber(raw) {
  const s = String(raw ?? "").replace(/[$,]/g, "").trim();
  const m = /^([\d.]+)([KMB])?$/.exec(s);
  if (!m) return null;
  const mult = m[2] === "B" ? 1e9 : m[2] === "M" ? 1e6 : m[2] === "K" ? 1e3 : 1;
  const n = Number(m[1]) * mult;
  return Number.isFinite(n) ? n : null;
}

/**
 * §9.0 (#2681) — the signal-coverage line.
 *
 * It renders ONLY when part of the tape is unscannable, so its absence is a PASS on a fully
 * scannable tape and a FAIL only when the tape demonstrably has ineligible prints. The caller
 * supplies that population; without it the verdict is HARNESS, not a guess.
 */
function coverageNoteVerdict(coverageLine, ineligibleRows) {
  // `null` means the LAYOUT offers no way to count them — distinct from `undefined`, which means
  // the caller forgot to measure. Desktop marks an estimated-time row with
  // `helix-tape-time--estimated`; `HelixMobileFlowTape` marks nothing at all, so on mobile the
  // population is unmeasurable rather than absent. Collapsing the two reported a harness fault on
  // every mobile run — flagging the instrument for a layout difference.
  if (ineligibleRows === null) {
    return {
      status: "NOT_EXERCISED",
      detail: "this layout carries no estimated-time marker, so the unscannable population cannot be counted here (mobile flow-cards; desktop marks them)",
    };
  }
  if (typeof ineligibleRows !== "number") {
    return { status: "HARNESS", detail: "the tape's ineligible-row count was never measured, so the note's absence cannot be judged" };
  }
  if (ineligibleRows <= 0) {
    return coverageLine
      ? { status: "FAIL", detail: `every print was scannable, yet the coverage note still claims prints were skipped: "${coverageLine}"` }
      : { status: "PASS", detail: "every print was scannable and the note correctly stays quiet" };
  }
  if (!coverageLine) {
    return { status: "FAIL", detail: `${ineligibleRows} rendered print(s) cannot be scanned and nothing on the page says so` };
  }
  return { status: "PASS", detail: `coverage stated: "${coverageLine}"` };
}

/**
 * §9.11 (#2691) — the split-flow direction labels.
 *
 * Two independent facts. The legacy "CALL BIAS"/"PUT BIAS" wording describes a quantity the code no
 * longer computes, so its presence is a FAIL whether or not the radar is populated — that check
 * works off-hours. The NEW labels only render on a populated radar, so their absence there is
 * NOT_EXERCISED.
 */
function directionLabelVerdict({ legacyPresent, newLabels, radarEmpty }) {
  if (legacyPresent) {
    return { status: "FAIL", detail: '"CALL BIAS"/"PUT BIAS" still rendered — that wording describes the pre-#2691 quantity' };
  }
  if (Array.isArray(newLabels) && newLabels.length) {
    return { status: "PASS", detail: `legacy wording gone; direction labels rendered: ${newLabels.join(", ")}` };
  }
  if (radarEmpty) {
    return {
      status: "NOT_EXERCISED",
      detail: "legacy wording is gone (a real check, and it passed), but the radar is empty — split flow needs a live 30-min window, so the populated labels are unverified",
    };
  }
  return { status: "HARNESS", detail: "radar is populated yet no direction label was found — the locator, not the product, is the likely fault" };
}

/**
 * §9.5 — the Expiry panel's buckets must agree with the tape's OWN rendered DTE column.
 *
 * The panel reads the RENDERED page, not the API window. Comparing against the wider API set
 * produced a false FAIL once (RUN-LOG 2026-08-23), so the caller must pass counts derived from the
 * same rendered rows.
 */
function expiryBucketVerdict(panelBuckets, renderedDte) {
  if (!panelBuckets || !Object.keys(panelBuckets).length) {
    return { status: "NOT_EXERCISED", detail: "no expiry buckets rendered" };
  }
  if (!Array.isArray(renderedDte) || !renderedDte.length) {
    return { status: "HARNESS", detail: "the tape's own DTE column was never read, so the buckets cannot be cross-checked" };
  }
  const n = renderedDte.filter((v) => Number.isFinite(v));
  const expect = {
    "0DTE": n.filter((v) => v <= 0).length,
    "This week": n.filter((v) => v > 0 && v <= 7).length,
    Monthly: n.filter((v) => v > 7 && v <= 30).length,
    LEAPS: n.filter((v) => v > 30).length,
  };
  const bad = [];
  for (const [label, want] of Object.entries(expect)) {
    const got = panelBuckets[label];
    if (got == null) { if (want > 0) bad.push(`${label} missing (expected ${want})`); continue; }
    if (got !== want) bad.push(`${label} panel=${got} tape=${want}`);
  }
  if (bad.length) return { status: "FAIL", detail: `expiry buckets disagree with the rendered DTE column: ${bad.join(" · ")}` };
  const expired = n.filter((v) => v < 0).length;
  return {
    status: "PASS",
    detail: `all buckets match the rendered tape${expired ? ` (${expired} expired print(s) correctly in 0DTE, not "This week")` : " (no expired prints in this render to exercise §9.5)"}`,
  };
}

module.exports = {
  routeBucketVerdict, panelVerdict, freshnessVerdict, overallVerdict, DOMINANT_BUCKET_PCT,
  newBadgeVerdict, coverageNoteVerdict, directionLabelVerdict, expiryBucketVerdict,
  parseCompactNumber, NEW_RATIO_TOLERANCE,
};
