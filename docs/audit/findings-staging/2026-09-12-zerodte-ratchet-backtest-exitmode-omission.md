## 2026-09-12 — 0DTE ratchet-mode backtest harnesses never set `exitMode`, silently grading `trim_scale` logic instead — corrected historical "ratchet wins" conclusion is now unverified

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED — harness bug corrected; the historical conclusion it produced is flagged unverified pending a re-run, no gate/production behavior changed. |
| **Severity** | P2 — no live member impact (production `exit-engine.ts` behavior is untouched), but a trusted calibration conclusion this repo has been citing since 2026-08-29 turns out to rest on a broken measurement. |

### What was found

Found during the Night Hawk three-engine deep-audit (operator mandate, 2026-09-12: "check everything A to Z... redesign everything") while adversarially cross-questioning a proposed new intermediate ratchet rung (+75% peak → +45% floor, to close the existing +50%→+100% protection gap in `EXIT_RULES`).

`scripts/audit/zerodte-sim.mjs`'s `gradeThroughExitEngine` and `scripts/audit/tier-exit-mode-ab.mjs`'s copy of the same function both build the "ratchet" grading arm's `ExitEngineInput` via a `mk(...)` closure that never sets `exitMode`. The real production `evaluateExitState` (`src/lib/zerodte/exit-engine.ts:641`) resolves `mode = input.exitMode ?? DEFAULT_EXIT_MODE`, and `DEFAULT_EXIT_MODE` is `"trim_scale"` (line 99) — **not** `"ratchet"` as a stale doc-comment on the `exitMode` field (lines 172-174) claimed. So every "ratchet" grading pass in both scripts was silently replaying `trim_scale` decision logic while labeling the output "ratchet."

Proved directly (not inferred): called the real `evaluateExitState` with the exact input the "ratchet" branch builds (peak=+92%, no `exitMode` key) — it returned `action:"TRIM", reason:"trim_scale_first"` (trim_scale logic), not the `RAISE_FLOOR`/`ratchet_profit_floor_set` behavior the identical input produces once `exitMode:"ratchet"` is explicitly set.

**Blast radius on prior conclusions:** `tier-exit-mode-ab.mjs`'s 2026-08-29 finding ("RATCHET wins 45.5% WR / +5.5% avg P&L vs trim_scale −7.3%", cited in PR history and `docs/audit/0DTE-RESEARCH.md`'s E5 note) never actually measured ratchet behavior — it measured trim_scale against itself under two different labels. A corrected, uncommitted spot re-measurement during this session's audit (90-day window, 100 graded C-tier/untiered rows) found genuine ratchet grades **30% WR / −6.8% avg P&L** — materially worse than the previously-reported number. This is disclosed here as directional evidence that the conclusion changes, not as a new authoritative measurement (see Follow-up below).

A third copy of this grading style, `scripts/audit/regime-dead-zone-ab.mjs`, was checked directly and does **not** have this bug — it only ever grades `trim_scale` mode (correctly, with `exitMode: "trim_scale"` already set) and has no separate ratchet-mode grader at all, so nothing there needed changing. (The cross-questioning agent's report suggested this file might share the bug; direct inspection before fixing anything found it does not — noted here so a future pass doesn't re-check it for nothing.)

### What changed

- `scripts/audit/zerodte-sim.mjs`: added `exitMode: "ratchet"` to the `mk(...)` object built inside the ratchet-mode branch of `gradeThroughExitEngine` (the sibling `trim_scale`-mode `mk` a few lines up already correctly set `exitMode: "trim_scale"` — only the ratchet arm was missing it).
- `scripts/audit/tier-exit-mode-ab.mjs`: same fix, same shape, in its own copy of `gradeThroughExitEngine`.
- `src/lib/zerodte/exit-engine.ts`: corrected the stale doc-comment on `ExitEngineInput.exitMode` that wrongly said the omitted-mode default is `"ratchet"` — it is `"trim_scale"` (`DEFAULT_EXIT_MODE`, line 99). Comment-only; no logic touched.
- **Not touched:** `regime-dead-zone-ab.mjs` (verified bug-free, see above); `EXIT_RULES`/`TRIM_SCALE_RULES`/any live gate or floor threshold; production `exit-engine.ts` behavior for real committed plays (the bug was in audit-tooling test-input construction only — real board/board.ts commits always pass an explicit `exitMode` via `resolveExitModeForTier`, so live member exits were never affected).

### Why this fix, not more

This PR fixes the measurement instrument only. It deliberately does **not** re-tune `EXIT_RULES`, add the proposed intermediate rung, or otherwise act on the corrected-but-informal 30%/−6.8% re-measurement above — that number came from an ad-hoc, unreviewed script run during the audit, not from the corrected `tier-exit-mode-ab.mjs` itself, and this repo's own standing discipline (see `docs/audit/INTENTIONAL-DESIGN.md` and the many `*-ab.mjs` tools that conclude "no gate changed, sample too thin") requires a proper harness re-run before trusting a new number, not a quick spot-check. Follow-up, not done here: re-run the now-corrected `tier-exit-mode-ab.mjs` for a fresh, citable ratchet-vs-trim_scale verdict, and treat every prior "ratchet wins" citation in this repo's docs (0DTE-RESEARCH.md's E5 note, any PR referencing the 2026-08-29 finding) as unverified until that re-run lands.

### Evidence

- Direct code read confirming the bug: `zerodte-sim.mjs` line 187 (pre-fix) and `tier-exit-mode-ab.mjs` line 134 (pre-fix) both omitted `exitMode` from their ratchet-arm `mk(...)` builder, while the sibling `trim_scale`-arm builders in the same files correctly included `exitMode: "trim_scale"`.
- Direct call to the real `evaluateExitState` with and without `exitMode: "ratchet"` on an identical input (peak=+92%, no trims yet) confirmed the two code paths diverge exactly as described (trim_scale-shaped `TRIM`/`trim_scale_first` vs the correct ratchet `RAISE_FLOOR`/`ratchet_profit_floor_set`).
- `src/lib/zerodte/exit-engine.ts` line 99 (`DEFAULT_EXIT_MODE: ZeroDteExitMode = "trim_scale"`) and line 641 (`const mode = input.exitMode ?? DEFAULT_EXIT_MODE`) directly confirm the fallback value the stale comment had backwards.
- Full `npm test` (Node 20) post-fix: 13829 pass / 0 fail / 3 skipped (pre-existing, unrelated). `npx tsc --noEmit`: clean. Both `.mjs` files syntax-checked with `node --check`.
- No regression test added: this is a pure input-construction fix in read-only audit tooling with no exported pure function to unit-test in isolation (the bug lived inside a closure inside a script-local function that already calls the real, already-tested `evaluateExitState`); the fix is proven by the direct `evaluateExitState` call above and by the two files' own established sibling pattern (the `trim_scale` arm already does this correctly).
