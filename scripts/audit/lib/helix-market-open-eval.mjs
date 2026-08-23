/**
 * Pure check table for scripts/audit/helix-market-open-check.mjs.
 *
 * WHY THIS EXISTS. On 2026-08-23 three criteria in `MARKET-OPEN-VALIDATION.md` were found to have
 * INVERTED — §5k told the reader to expect a jump where the measurement falls, §5f required a
 * marker no row can render, §5c diagnosed a regression that had not happened. None of them failed
 * loudly. They could not: they were PROSE, and prose does not run.
 *
 * Every check here is one of those criteria stated so it CAN fail. That is the whole point — not
 * to replace the runbook, which carries the reasoning, but to make the handful of binary claims
 * inside it executable so they cannot silently invert again.
 *
 * ── FOUR RULES, EACH PAID FOR TODAY ─────────────────────────────────────────────────────────────
 *
 * 1. EVERY ROW PRINTS ITS EXPECTATION. A verdict without the expectation beside it is exactly what
 *    let §5k read backwards for a day. `expect` is not decoration; it is the thing being tested.
 *
 * 2. A HARNESS THAT COULD NOT RUN IS `HARNESS`, NEVER `RED`. A missing sub-report says nothing
 *    about the product. The /flows UI audit already encodes this and it saved a false verdict this
 *    morning when a mid-rollout 404 would otherwise have read as a broken panel.
 *
 * 3. ANYTHING NEEDING A MOVING TAPE IS `AMBER`, WITH THE REASON — never a silent pass. Off-hours
 *    both radars are empty; reporting that as GREEN would assert coverage nobody measured.
 *
 * 4. NO VERDICT OVER AN EMPTY POPULATION. Zero rows is `HARNESS`, not a clean sweep.
 */

export const VERDICTS = Object.freeze(["GREEN", "AMBER", "RED", "HARNESS"]);

const row = (id, section, expect, measured, verdict, note) => ({
  id, section, expect, measured, verdict, note: note ?? null,
});

/**
 * @param tape       parsed `helix-tape-inventory.mjs --json`, or null if it could not run
 * @param darkpool   parsed `helix-darkpool-inventory.mjs --json`, or null
 * @param expiryMinus1  what the REAL `expiryHorizonLabel(-1)` returns — imported by the runner,
 *                      never restated here
 */
export function evaluateChecks({ tape, darkpool, expiryMinus1 }) {
  const out = [];

  // ── §9.5 — pure, always checkable, no live data needed ────────────────────────────────────────
  out.push(
    expiryMinus1 === "0DTE"
      ? row("§9.5", "expiry bucketing", 'expiryHorizonLabel(-1) === "0DTE"', expiryMinus1, "GREEN")
      : row("§9.5", "expiry bucketing", 'expiryHorizonLabel(-1) === "0DTE"', String(expiryMinus1), "RED",
            "an expired print is being filed under a FUTURE horizon")
  );

  if (!tape) {
    out.push(row("§5k", "event_at parse", "event_at 100%, alert_rule < 100%", "tape inventory did not run", "HARNESS"));
    out.push(row("§9.0", "signal eligibility", "eligible === total", "tape inventory did not run", "HARNESS"));
    out.push(row("§4A", "writer split", "mixed 0, unknown 0", "tape inventory did not run", "HARNESS"));
    out.push(row("§5c", "aggressor coverage", "Group A ask_pct >= 90%", "tape inventory did not run", "HARNESS"));
    out.push(row("§9.4", "IV units", "shipped renderer suits the feed", "tape inventory did not run", "HARNESS"));
  } else {
    const rows = tape.response?.rows ?? 0;
    const p = tape.field_presence_pct ?? {};
    const el = tape.signal_eligibility ?? {};
    const w = tape.writers ?? {};

    if (rows === 0) {
      // Rule 4. An empty tape cannot support any verdict about the tape.
      for (const [id, sec, exp] of [
        ["§5k", "event_at parse", "event_at 100%, alert_rule < 100%"],
        ["§9.0", "signal eligibility", "eligible === total"],
        ["§4A", "writer split", "mixed 0, unknown 0"],
        ["§5c", "aggressor coverage", "Group A ask_pct >= 90%"],
        ["§9.4", "IV units", "shipped renderer suits the feed"],
      ]) out.push(row(id, sec, exp, "tape returned 0 rows", "HARNESS", "nothing was measured — not a pass"));
    } else {
      // §5k — THE highest-impact claim, and the one that inverted.
      //
      // WHAT IS ACTUALLY BEING TESTED: that the two fields have DECOUPLED. Before #2723 `event_at`
      // was present if and only if `alert_rule` was (measured exactly: SPX 39/39, SPY 82/82); after
      // it, every row carries a real print time while `alert_rule` stays at ~30%. A regression
      // collapses `event_at` back toward `alert_rule`, and THAT is the signal.
      //
      // IT DOES NOT DEMAND event_at === 100, deliberately. Off-hours the tape is settled and reads
      // exactly 100%. Under a MOVING tape a single print whose time cannot be resolved — an
      // unparseable `created_at` with a usable `inserted_at`, which `resolveFlowTimes` reports as
      // `tape_time_estimated` — drops it to 99.8%. Gating on equality would fire RED on the
      // highest-impact row of a working deploy, which is exactly the false-alarm shape this whole
      // gate exists to prevent. The margin is what carries the meaning; the round number does not.
      const ev = p.event_at?.all, ar = p.alert_rule?.all;
      const EV_FLOOR = 95;          // tolerates a handful of genuinely undatable prints
      const DECOUPLE_MARGIN = 20;   // pre-#2723 the two were EQUAL; anything near that is a collapse
      const decoupled = ev != null && ar != null && ev >= EV_FLOOR && ev - ar > DECOUPLE_MARGIN;
      out.push(
        decoupled
          ? row("§5k", "event_at parse", `event_at >= ${EV_FLOOR}% AND at least ${DECOUPLE_MARGIN}pp above alert_rule`,
                `event_at ${ev}% · alert_rule ${ar}% · margin ${ev == null || ar == null ? "n/a" : (ev - ar).toFixed(1)}pp`, "GREEN",
                ev < 100 ? `${(100 - ev).toFixed(1)}% of rows carry no resolvable print time — within tolerance, not a fault` : null)
          : row("§5k", "event_at parse", `event_at >= ${EV_FLOOR}% AND at least ${DECOUPLE_MARGIN}pp above alert_rule`,
                `event_at ${ev}% · alert_rule ${ar}%`, "RED",
                ev != null && ev < EV_FLOOR
                  ? "event_at coverage has collapsed — the deploy may not carry #2723, or the wire format moved"
                  : "the two fields have re-coupled, which is the pre-#2723 signature")
      );

      // §9.0 — eligibility is the denominator every signal claim rests on.
      //
      // A FLOOR, NOT EQUALITY — for exactly the reason §5k carries one. Eligibility is
      // `flowEventTimeMs(flow) != null`, i.e. the SAME field §5k measures, so a single print whose
      // time cannot be resolved makes `eligible !== total`. Demanding equality would fire RED on a
      // working deploy the first time one row arrives undatable. Pre-#2723 this sat at 30%; a real
      // regression collapses back toward that, and the floor catches it while the tolerance absorbs
      // ordinary live-tape wobble.
      const ELIG_FLOOR_PCT = 95;
      const eligPct = el.total > 0 ? (el.eligible / el.total) * 100 : null;
      out.push(
        eligPct != null && eligPct >= ELIG_FLOOR_PCT
          ? row("§9.0", "signal eligibility", `eligible >= ${ELIG_FLOOR_PCT}% of total`, `${el.eligible}/${el.total} (${eligPct.toFixed(1)}%)`, "GREEN",
                el.ineligible > 0
                  ? `${el.ineligible} print(s) unplaceable — within tolerance: ${(el.ineligibleTickers ?? []).slice(0, 6).join(", ")}`
                  : null)
          : row("§9.0", "signal eligibility", `eligible >= ${ELIG_FLOOR_PCT}% of total`, `${el.eligible}/${el.total}${eligPct == null ? "" : ` (${eligPct.toFixed(1)}%)`}`, "RED",
                `${el.ineligible} print(s) cannot be placed in time: ${(el.ineligibleTickers ?? []).slice(0, 6).join(", ")}`)
      );

      // §4A — the clean two-writer split. The inventory's own comment: the first row that breaks it
      // IS the news, so it must not be folded away.
      // A FEW stray rows are NEWS, not a failed open. The inventory documents that the first row
      // breaking the clean split is the finding — but "worth surfacing" and "block the open" are
      // different calls, and one malformed row should not be the second. Small breaks are AMBER
      // with the count; a real structural break is RED.
      const mixed = w.mixed ?? 0, unknown = w.unknown ?? 0;
      const strays = mixed + unknown;
      const STRAY_RED_PCT = 0.5;
      const strayPct = rows > 0 ? (strays / rows) * 100 : 0;
      out.push(
        strays === 0
          ? row("§4A", "writer split", "mixed 0, unknown 0", `A ${w.A?.rows} · B ${w.B?.rows} · B holds ${w.B_premium_share_pct}% of premium`, "GREEN")
          : strayPct < STRAY_RED_PCT
            ? row("§4A", "writer split", `strays under ${STRAY_RED_PCT}% of rows`, `mixed ${mixed} · unknown ${unknown} (${strayPct.toFixed(2)}%)`, "AMBER",
                  "a row carries both producers' markers or neither — news, worth capturing, but not a structural break")
            : row("§4A", "writer split", `strays under ${STRAY_RED_PCT}% of rows`, `mixed ${mixed} · unknown ${unknown} (${strayPct.toFixed(2)}%)`, "RED",
                  "the clean two-writer split has genuinely broken — the exact split is what several HELIX numbers rest on")
      );

      // §5c — the check that still works after the criterion was rewritten. GROUP A coverage is
      // what can regress; Group B is 0 by construction and must not be read as one.
      const askA = p.ask_pct?.A;
      out.push(
        askA != null && askA >= 90
          ? row("§5c", "aggressor coverage", "Group A ask_pct >= 90%", `A ${askA}% · B ${p.ask_pct?.B ?? "n/a"}%`, "GREEN",
                "Group B at 0% is expected — that feed sends no aggressor side")
          : row("§5c", "aggressor coverage", "Group A ask_pct >= 90%", `A ${askA}%`, "RED",
                "readable direction has regressed on the writer that HAS an aggressor side")
      );

      // §9.4 — the assumption behind #2669's unconditional x100.
      const iv = tape.iv_units ?? {};
      out.push(
        iv.verdict == null
          ? row("§9.4", "IV units", "feed uniformly fractional", "insufficient sample", "AMBER", "below the sample floor — no verdict")
          : iv.shipped_renderer_ok
            ? row("§9.4", "IV units", "feed uniformly fractional", `${iv.verdict}, median ${iv.median}`, "GREEN")
            : row("§9.4", "IV units", "feed uniformly fractional", `${iv.verdict}`, "RED",
                  "fmtIv multiplies unconditionally — a non-fractional feed makes every IV wrong")
      );
    }
  }

  // ── §5l — dark-pool sided coverage. Reported, not gated: 0% is the CORRECT off-hours state and
  //    the panel refusing on it is the fix working, not a fault. Rule 3.
  if (!darkpool) {
    out.push(row("§5l", "dark-pool coverage", "report sided premium share", "darkpool inventory did not run", "HARNESS"));
  } else if ((darkpool.returned ?? 0) === 0) {
    out.push(row("§5l", "dark-pool coverage", "report sided premium share", "0 prints returned", "HARNESS", "nothing was measured — not a pass"));
  } else {
    const c = darkpool.coverage ?? {};
    const pctSided = c.sidedPremiumPct;
    out.push(
      row("§5l", "dark-pool coverage", "report sided premium share", `${pctSided == null ? "n/a" : pctSided.toFixed(1)}% of premium sided (${c.sidedPrints}/${c.totalPrints} prints)`,
          "AMBER",
          pctSided === 0
            ? 'expected: the feed reports no side, so the badge correctly renders "—". NOT a defect.'
            : "sided data present — spot-check the badge against the print list by hand")
    );
  }

  return out;
}

/** Worst verdict wins, and HARNESS is never absorbed into a product verdict. */
export function rollup(rows) {
  const has = (v) => rows.some((r) => r.verdict === v);
  if (has("RED")) return "RED";
  if (has("HARNESS")) return "HARNESS";
  if (has("AMBER")) return "AMBER";
  return rows.length > 0 ? "GREEN" : "HARNESS";
}
