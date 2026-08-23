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
      // §5k — THE highest-impact claim, and the one that inverted. After #2723 every row carries a
      // real print time, so the two fields must have STOPPED co-varying.
      const ev = p.event_at?.all, ar = p.alert_rule?.all;
      out.push(
        ev === 100 && ar != null && ar < 100
          ? row("§5k", "event_at parse", "event_at 100% AND alert_rule < 100%", `event_at ${ev}% · alert_rule ${ar}%`, "GREEN")
          : row("§5k", "event_at parse", "event_at 100% AND alert_rule < 100%", `event_at ${ev}% · alert_rule ${ar}%`, "RED",
                ev !== 100
                  ? "event_at is no longer universal — the deploy may not carry #2723, or the wire format moved"
                  : "the two fields co-vary again, which is the pre-#2723 signature")
      );

      // §9.0 — eligibility is the denominator every signal claim rests on.
      out.push(
        el.total > 0 && el.eligible === el.total
          ? row("§9.0", "signal eligibility", "eligible === total", `${el.eligible}/${el.total}`, "GREEN")
          : row("§9.0", "signal eligibility", "eligible === total", `${el.eligible}/${el.total}`, "RED",
                `${el.ineligible} print(s) cannot be placed in time: ${(el.ineligibleTickers ?? []).slice(0, 6).join(", ")}`)
      );

      // §4A — the clean two-writer split. The inventory's own comment: the first row that breaks it
      // IS the news, so it must not be folded away.
      const mixed = w.mixed ?? 0, unknown = w.unknown ?? 0;
      out.push(
        mixed === 0 && unknown === 0
          ? row("§4A", "writer split", "mixed 0, unknown 0", `A ${w.A?.rows} · B ${w.B?.rows} · B holds ${w.B_premium_share_pct}% of premium`, "GREEN")
          : row("§4A", "writer split", "mixed 0, unknown 0", `mixed ${mixed} · unknown ${unknown}`, "RED",
                "a row carries both producers' markers or neither — the exact split is the finding")
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
