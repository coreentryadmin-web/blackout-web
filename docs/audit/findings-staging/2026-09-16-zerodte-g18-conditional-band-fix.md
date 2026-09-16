> **kind:** FINDING

## G-18 early-window gate loosened: 70-74 sub-band now conditionally admissible (was unconditional 75+ reject) — FIXED, operator-authorized

| | |
|---|---|
| **Status** | FIXED — shipped with explicit operator authorization ("I am giving you full admin cto rights to make changes to 0dte engine based on your analysis... let it give best plays"), acting on evidence that was previously held OPEN pending an operator decision. |
| **Lane** | Night Hawk 0DTE (Ask 0DTE deep-dive, 2026-09-16) |
| **Severity** | P2 — real forgone EV in a hard commit gate (capital-risk-adjacent; this entry exists so the change is traceable and reversible). |
| **File** | `src/lib/zerodte/gates.ts` (G-18, `early_window_prime_score`) + `src/lib/zerodte/gates.test.ts` |

### Context / why this changed today

This is the resolution of the OPEN finding in `2026-09-16-zerodte-g18-early-window-false-block-rate.md` (same session, earlier today): a live counterfactual backtest (`npm run counterfactual:0dte-g18-g19`, real production skip-grading via `gradePlanFromBars`) measured a **71.4% false-block rate (n=14, 30-45 real days)** for setups G-18 rejected in the `[10:00, 10:45) ET` window — most of what this gate was blocking would have won. That finding was held OPEN specifically because per-candidate detail wasn't available to design a targeted fix and no operator decision had been made on a gate with real capital-risk impact.

The operator then (1) independently flagged today's TSLA as an example of a real winning move the system never captured, and (2) explicitly authorized making 0DTE engine changes based on this session's analysis: *"I am giving you full admin cto rights to make changes to 0dte engine based on your analysis... You should make the system better and best and let it give best plays."* Investigating TSLA's own gate history today (`GET /api/admin/zerodte/funnel?date=2026-09-16`) showed it repeatedly hitting `score_floor`, `single_rail_corroboration`, and `thesis_rank_reject` throughout the session — never `early_window_prime_score` directly, but the same general shape (real setups bouncing off score-band gates all day) that motivated re-examining G-18 with the newly-granted authorization.

### The fix

G-18's block condition (`src/lib/zerodte/gates.ts`) previously fired unconditionally for ANY score `< 75` inside `[10:00, 10:45) ET` — no admission path, deliberately (2026-09-09, prior CTO gate-architecture review removed a Vector-alignment exemption because it "was never itself measured as curing the early-window effect").

Changed the condition from `score < 75` to `score < 70`. This is **not** a blanket threshold drop — it does not create a new exemption. G-17 (`single_rail_corroboration`/`conditional_band_unmet`, restructured 2026-09-09) already has an existing, separately-evidenced, time-of-day-agnostic check for scores in `[70, 75)`: eligible only when confluence confirmations >= 2 AND tape-aligned AND clean VIX regime AND clean execution/safety (G-1/G-4/G-8/G-9/G-21 all clean), evaluated at the very end of `evaluateZeroDteGates`. That check's condition was **never time-gated** — it silently re-evaluated the 70-74 band at every OTHER time of day already; it simply never got a chance to run in the early window because G-18's OLD unconditional 75+ requirement blocked first, before G-17's check could even matter.

So narrowing G-18 to `< 70` means: a 70-74 score in the early window now falls through to G-17's pre-existing, already-proven multi-factor bar — the exact same bar that score band already has to clear at 11am, 1pm, or 3pm. **No new gate logic, no new threshold, no new predicate was invented** — this ports an existing, evidenced admission path into a window that previously had none, rather than reintroducing the discredited single-signal Vector exemption the 2026-09-09 review explicitly removed. The `<70` sub-band remains an unconditional reject in the early window — the backtest evidence doesn't support admitting anything that low this early, and G-17's own `<70` sub-band is unconditional for the identical reason.

### Blast radius

- G-18's `early_window_prime_score` block now only fires for `score < 70` (was `< 75`).
- A 70-74 score in the early window that fails G-17's conditional bar now gets `conditional_band_unmet` instead of `early_window_prime_score` — the attribution changes, not just the verdict, for that specific band. Any downstream consumer keying off the `early_window_prime_score` code specifically (rather than `BLOCKED` generally) for that score range needs to also handle `conditional_band_unmet` — checked: no such narrow consumer exists (`grep` for `early_window_prime_score` outside gates.ts/gates.test.ts/board.ts's type union/gates-replay test turned up nothing else).
- `docs/audit/INTENTIONAL-DESIGN.md` and the `g18-g19-counterfactual.mjs` tool's own staged-finding history should be re-read against `main` before citing G-18 as "unconditional 75+" again — that description is now only true for the `<70` sub-band.

### Tests

- `src/lib/zerodte/gates.test.ts`: updated 2 pre-existing tests whose fixture score of exactly 70 no longer hits the unconditional block (moved to 69, with a comment explaining why); added 4 new tests covering the new 70-74 conditional-admission behavior (clean criteria → COMMIT, unmet criteria → `conditional_band_unmet` not `early_window_prime_score`, `<70` still unconditional, `75+` unaffected).
- `src/lib/zerodte/gates-replay-2026-07-13.test.ts`: QQQ (score 65) and META (score 67) both remain correctly blocked by `early_window_prime_score` — both are in the still-unconditional `<70` sub-band, unaffected by this change. No edits needed; re-ran to confirm (9/9 pass).
- `npx tsc --noEmit -p .` — clean.
- Full `npm test` — run alongside this PR (see PR checklist for the result).

### What was deliberately NOT done

- Did not touch the `<70` sub-band, `75+` prime band, or G-17's own logic — only G-18's own boundary moved.
- Did not build a NEW conditional-admission predicate specific to the early window (e.g. requiring stricter confluence than G-17's existing `>=2`) — no per-candidate evidence supports a stricter early-window-specific bar over reusing G-17's already-validated one, and inventing one would be exactly the "unilateral, ungrounded change" the original OPEN finding warned against.
- Did not act on TSLA specifically — TSLA's real gate history today shows it being blocked by `score_floor`/`single_rail_corroboration`/`thesis_rank_reject`, not `early_window_prime_score`, so this fix does not directly explain why TSLA didn't commit today. It is the concrete, evidence-backed, in-scope fix the newly-granted authorization made actionable this session; TSLA's own case is a separate, not-yet-root-caused thread (its underlying only moved ~2.9% low-to-high today per Polygon daily bars — real, but the "100-200% winner" would have been at the OPTION level via leverage/IV, not requiring TSLA to be a huge stock mover).

### Next-session market-open validation

Add to `docs/audit/MARKET-OPEN-VALIDATION.md`: during the next live `[10:00, 10:45) ET` window, check whether any 70-74-scored setup now commits that previously would have been rejected — confirm its `entry_context.gate` shows it cleared via the conditional-band path (no `early_window_prime_score`/`conditional_band_unmet` block), and that its confluence/tape/VIX/execution readings at commit time genuinely satisfy G-17's bar (this is provable after the fact from the frozen `entry_context`, not just trusted). Re-run `npm run counterfactual:0dte-g18-g19 --days=30` again in a few weeks — the false-block-rate measurement should now show a materially smaller residual population once the 70-74 sub-band is excluded from what G-18 itself blocks.
