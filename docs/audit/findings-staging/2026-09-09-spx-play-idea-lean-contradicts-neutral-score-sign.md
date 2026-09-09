> **kind:** `FINDING`

## SPX Slayer `play_idea` lean fallback ignored the score's own sign, contradicting a net-positive score with a "Puts lean" line — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | SPX Slayer play-idea generation (`src/features/spx/lib/spx-play-intel.ts` `resolveLeanDirection`) |
| **PR** | (pending — `fix/spx-play-idea-lean-direction-sign`) |

### Symptom

Flagged as an unconfirmed trace by the prior 5-engine monitor cycle and reproduced live this
cycle via `GET /api/market/spx/play` (2026-09-09, off-hours/`SCANNING`): the top-level
`direction` field was correctly `null` (bias `neutral`, `|score| < 10` per `spx-signals.ts`'s own
threshold — no explicit lean, by design), yet the `gates.play_idea` line read:

> `"Tape's mixed, but Puts lean — 7720 Put on watch · bearish broad flow"`

while the confluence engine's own `score` field, computed from the SAME `factors[]` array shown
alongside it, was **+8** (net weakly bullish: `0DTE flow +14, VWAP +12, Market tide -10, TICK -8,
TRIN +6, News risk -6, ADD -5, EMA20 +5` = +8). A trader reading the play_idea line sees a
confident bearish assertion directly contradicting the net-positive score sitting one field away
in the same payload.

### Root cause

`resolveLeanDirection` in `spx-play-intel.ts` (used only by `buildPlayIdea`, a second, independent
direction computation from the one that produces the top-level `direction`/`bias` fields in
`spx-signals.ts`) has a fallback chain:

```
if (confluence.direction is long/short) return it
if (confluence.bias === "bullish") return "long"
if (confluence.bias === "bearish") return "short"
if (confluence.score >= 12) return "long"
if (confluence.score <= -12) return "short"
return desk.above_vwap ? "long" : "short"   // <-- the bug
```

When bias is `"neutral"` (i.e. `|score| < 10`, per `spx-signals.ts`) and `|score| < 12` (the
explicit-lean threshold this same function checks two lines above), the final fallback drops the
score entirely and substitutes an **unrelated boolean** — whether spot is currently above VWAP —
with no requirement that it agree with the sign of the very score the API already displays next
to it. Live: `score = +8` (bullish-leaning) but `desk.above_vwap = false` (price sat below VWAP at
that snapshot) → fallback picked `"short"`, directly against the score's sign.

This is not a hypothetical edge case: any score in `(-12, -10]∪[10, 12)` low-magnitude weak zone,
or in `(-10, 10)` (where bias is neutral by construction), can have its sign disagree with
above_vwap — VWAP position is one input among ~8 factors summed into score, not a proxy for their
net sign.

### Fix rationale

Added two checks ahead of the `above_vwap` fallback: `score > 0` → `"long"`, `score < 0` →
`"short"`. Only a score of **exactly 0** (genuinely zero net lean information — the one case where
there is nothing else to break the tie with) still falls through to the VWAP-position proxy. This
keeps the function's contract (`resolveLeanDirection` never returns null — `buildPlayIdea` always
picks a side, by design, for the "mixed tape" watch-idea copy) while removing the one case where
the picked side contradicted the caller's own posted score.

Deliberately left unchanged: the `bias`/explicit `direction`/`score >= 12` tiers above it (those
already source from the score correctly), and the top-level `confluence.direction: null` behavior
in `spx-signals.ts` itself (a `null` direction under a weak/neutral score is the intended,
documented "no clean signal" state — the bug was only in the SEPARATE, always-committal
`play_idea` line built downstream of it).

### Blast radius

Single call site (`buildPlayIdea`, called once from `spx-play-payload.ts` to build
`gates.play_idea`). No other consumer of `resolveLeanDirection` exists (checked via grep — the
function is not exported).

### Evidence

Regression test `src/features/spx/lib/spx-play-intel.test.ts` (new file — no prior test existed
for this module): RED pre-fix — `buildPlayIdea` with `score=+8, above_vwap=false` returned
`direction: "short"` (asserted `"long"` expected, failed); `score=-8, above_vwap=true` returned
`"long"` (asserted `"short"`, failed). GREEN post-fix, all 3 cases pass including the `score===0`
VWAP-fallback case, which is unchanged. `npx tsc --noEmit -p .` clean. Pre-existing, unrelated
failures in `spx-play-engine.test.ts`/`spx-play-gates.test.ts` confirmed present identically on
`main` via `git stash` (not touched by this fix).

### Not done here

Whether the top-level `direction`/`score`/`bias` architecture itself should surface a genuine
"weak lean" tier (rather than jumping straight from `neutral`/`null` at `|score|<10` to an
always-committal downstream `play_idea` line) is a larger design question left to a follow-up —
this fix only makes the existing fallback internally consistent with the score it already shows.
