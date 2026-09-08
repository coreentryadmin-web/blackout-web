> **kind:** `FINDING`

## Chart technicals bias badge echoed the play's own LONG/SHORT direction instead of the technicals it labels — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Pri** | P2 (HIGH per source audit — data-correctness, member-facing, misleading exactly during post-mortem review) |
| **Area** | Night Hawk Swings — Ask Largo play-brief, `play-brief-intel.ts` "Chart technicals" section |
| **PR** | (pending) |

### Symptom

`chartTechnicalsSection`'s `bias` field (`SWING-SYSTEM-CTO-AUDIT-2026-09-06.md` finding #13) was set
via `play.direction === "SHORT" ? "bearish" : play.direction === "LONG" ? "bullish" : "neutral"` — a
pure echo of the position's own direction, carrying zero information from the EMA stack / MACD /
VWAP side / market-structure lines the badge is attached to. Live evidence in the audit: an INTC
SHORT play tagged `[bearish]` while its body read EMA-up, price-above-VWAP, RSI 67, MACD bull,
CHOCH up (an entirely bullish tape); an NN LONG play tagged `[bullish]` while its body read EMA-down,
price-below-VWAP, MACD bear, BOS down (entirely bearish); and a closed AAPL LONG play tagged
`[bullish]` on its own post-mortem while its technicals read entirely bearish. A trader reading a
colored badge on "Chart technicals" reasonably expects it to mean "these technicals currently read
bullish/bearish" — it meant only "this position happens to be LONG/SHORT."

### Fix

Added `technicalsBias()` — a majority vote across the four directional signals already rendered in
the section (EMA stack up/down, MACD bull/bear, spot-vs-VWAP side, market-structure BOS/CHOCH
direction). A 2-2 split or no readable signals falls back to `neutral` (an absent verdict is honest;
a wrong one is not — same discipline as HELIX's `minorityEvidence` gate in
`helix-direction-read.ts`). `chartTechnicalsSection` no longer takes a `play: TerminalPlay` param at
all — its bias is now derived entirely from the technicals it already has in hand.

### Evidence (RED → GREEN)

Added 3 cases to `src/lib/swing/play-brief-intel.test.ts` reproducing the audit's exact INTC (SHORT
+ bullish tape → bias must read bullish) and NN (LONG + bearish tape → bias must read bearish)
shapes, plus a genuine 2-2 tie → neutral case. Proof via `git stash` on the source file (Node 20):
RED (pre-fix) — 3/3 new tests fail (the two directional cases print the old play-direction-echoed
value; the tie case crashes on the now-removed second parameter). GREEN (post-fix): 13/13 pass.

Full `src/lib/swing/*.test.ts`: 641/641 pass. `npx tsc --noEmit`: clean.

### Blast radius

Single call site (`chartTechnicalsSection(vec, play)` → `chartTechnicalsSection(vec)` in
`composeSwingPlayBrief`). `RichSection.bias` has no other consumer that assumes it mirrors
`play.direction` (checked `rich-narrative.ts` and the terminal-display adapters).
