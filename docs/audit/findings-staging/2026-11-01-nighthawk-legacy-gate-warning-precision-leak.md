> **kind:** FINDING

## Night Hawk Legacy: G-N2 gate_warning text leaked a raw 4-decimal ATR multiple that contradicted the sibling 2dp `target_atr_multiple` field — FIXED

| **Status** | Fixed |
|---|---|

**Found by:** five-engine-largo-cycle-67 live audit (2026-11-01, `check:legacy` agent), adversarially
re-verified by an independent `verify:legacy` agent against live production and current source
before being accepted — per the standing 5-engine live monitor + Ask Largo mandate.

**Root cause:** `src/features/nighthawk/lib/publish-gates.ts`'s G-N2 "achievable target" gate computes
`targetAtrMultiple = round4(Math.abs(geo.target! - geo.fill_edge!) / geo.atr14!)` — 4-decimal
precision — and, when the gate fails, interpolated that same raw value verbatim into the member-facing
`reason` string (`` `target $${geo.target} is ${targetAtrMultiple}× ATR14 ...` ``, both the `scale_out`
and non-`scale_out` branches). `edition-builder.ts:1577-1578` pins the identical `round4` value onto
the play's structured `target_atr_multiple` field, which the API route then rounds to 2dp via
`roundFloats()` before serialization. `roundFloats()`'s `walk()` only rewrites nodes where
`typeof v === "number"` — it can never reach a number already baked into a string — so the two
member-facing surfaces of the exact same quantity disagreed in precision. The G-N1 "band-vs-spot"
gate's `band_detached` reason carried the identical pattern (`round4` value interpolated raw), though
it had no currently-published 2dp sibling field to visibly contradict — fixed identically on the same
root cause.

**Live evidence (2026-11-01, authenticated `GET /api/market/nighthawk/edition?date=...`), four
separate gate-promoted `scale_out` plays on four different dates — each case the structured field is
the exact 2dp rounding of the number embedded raw in the warning string:**

| Date | Ticker | `target_atr_multiple` (field, 2dp) | `gate_warnings` text (raw) |
|---|---|---|---|
| 2026-10-30 | STM | `2.4` | `...is 2.4019× ATR14...` |
| 2026-10-29 | AXTI | `2.24` | `...is 2.242× ATR14...` |
| 2026-10-29 | ORCL | `2.1` | `...is 2.0988× ATR14...` |
| 2026-10-27 | NU | `2.1` | `...is 2.1039× ATR14...` |

Rendered verbatim to members in `PlaybookBriefingPanel.tsx`'s "Gate caveats" section
(`<li key={i}>{w}</li>`, gated on `gate_promoted && gate_warnings.length`) alongside the same panel's
`reachability` note (built from the 2dp `target_atr_multiple` field) — a member looking at a single
gate-promoted play's briefing saw both "2.4×" and "2.4019×" describing the identical number. Also
surfaced as a `PlaybookPlayRow.tsx:132` tooltip.

Verified not already fixed/tracked: `git log -- publish-gates.ts` shows the most recent touch
(`f5fbaa1a8`, 2026-10-31, "G-N2 gate_warning text contradicts scale_out risk_note") edited these exact
lines only to branch the reason wording for `scale_out` vs non-`scale_out` plays — it left the raw
`${targetAtrMultiple}` interpolation itself untouched. `publish-gates.test.ts` had no assertion on the
reason string's numeric precision.

**Fix:** added a display-only `round2` helper alongside the existing `round4`. Both reason strings
(G-N2's `scale_out`/non-`scale_out` branches, G-N1's `band_detached`) now interpolate the 2dp-rounded
value; `checks[]`/`blocks[].value` (and therefore `target_atr_multiple`/the admin calibration,
debrief, and promotion-eligibility consumers that read the gate's `value`) are untouched — still full
`round4` precision. Purely a display-string fix, no gate-logic or calibration change.

**Evidence (RED → GREEN):** added a regression test to
`src/features/nighthawk/lib/publish-gates.test.ts` reusing the existing 2.025× boundary fixture
(chosen because round4→round2 actually changes the printed digits there — 2.025 rounds to 2.03, not
a no-op). RED (via `git stash` on `publish-gates.ts` alone): 41/42 pass, 1 fail — the reason string
still showed the raw `2.025×` instead of the 2dp-rounded `2.03×`. GREEN (post-fix):
`npx tsx --experimental-test-module-mocks --test publish-gates.test.ts` → 42/42 pass. `npx tsc
--noEmit`: clean.

**Blast radius:** `publish-gates.ts` is the sole owner of both reason strings (grep-confirmed — no
other call site constructs a G-N1/G-N2 `reason`). `checks[].value`/`blocks[].value` (admin
calibration/debrief/`targetAtrMultipleFromGateResult` consumers), the gate's pass/fail verdict, and
promotion eligibility (`isPromotableBlockedPlay`/`NON_PROMOTABLE_GATE_CODES`) are all unchanged —
deliberately left on full `round4` precision since those are internal consumers, not member-facing
copy.
