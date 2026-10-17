> **kind:** FINDING

## Ask Largo swing play-brief: "Exec P&L" line missing the same open-runner-only qualifier its sibling P&L line already has — FIXED

| **Status** | Fixed (`src/lib/swing/play-brief.ts`'s `pnlSection`) |
|---|---|

**Found via:** this session's standing Ask Largo × Night Hawk Swings deep-dive (a lighter follow-up workflow run after the Peak/Trough fix, PR #6137, checking genuinely new tickers not covered in the prior pass).

**Live repro.** `GET /api/market/swing/play-brief?playId=SWING:CAVA:1875&ticker=CAVA&positionId=1875` (2026-10-17, Banger-origin STANDARD, one trim already banked at +100%, runner still open). The Position section rendered, in order:
```
P&L: **+102.2%** _(open runner only — trim already banked, see below)_
Peak / Trough / Greeks / Spread
Blended P&L (realized trim + open runner): **+101.1%**
Banked: 50% @ +100% ($1.38)
Exec P&L: **+76.8%**
```
The plain `P&L` line already discloses it is runner-only whenever a trim has fired (`blended != null`). `Exec P&L` — priced on the identical open-runner-only basis, just at the bid instead of the mid (`execSlippageCoaching`, `play-brief-narrative-coaching.ts`, diffs `play.pnlPct` vs `play.execPnlPct` as "mid vs fill" on the same scope) — carried no qualifier at all. By the time a reader reaches `Exec P&L`, the immediately preceding `Blended P&L`/`Banked` lines have established a whole-position frame, so the unqualified `+76.8%` reads as "what I'd net exiting my entire remaining position right now" rather than "the runner leg's own fill-based P&L" — the exact misread class this file has fixed repeatedly for the plain P&L line (live repros: CRWD positionId 19 2026-09-14, NRG 2026-09-11, NN positionId 32 2026-09-10), just never reaching this sibling line.

**Root cause.** `pnlSection` (~line 630, pre-fix) rendered `Exec P&L: **${fmtPct(play.execPnlPct)}**` unconditionally, with no reference to `blended` — unlike the plain P&L line a few lines above it (~line 512), which already appends `" _(open runner only — trim already banked, see below)_"` whenever `blended != null`.

**Fix.** Append the identical qualifier to the `Exec P&L` line whenever `blended != null`, pointed the other direction (`see above`, since Blended P&L/Banked render before Exec P&L in this section, the reverse order from the plain P&L line).

**Tests.** Two new tests in `src/lib/swing/play-brief.test.ts`: one constructs the CAVA-shaped fixture (trim fired, `execPnlPct` distinct from `pnlPct`) and asserts the qualifier now renders; one confirms no qualifier is added when no trim has fired (no false disclosure). RED→GREEN proven via `git stash` of `play-brief.ts` alone (1 failure without the fix, 0 with it restored). Full `src/lib/swing` suite: 1818/1818 pass. `tsc --noEmit`: clean.

**Blast radius:** `pnlSection` is the sole renderer of both the P&L and Exec P&L lines — no duplicate implementation elsewhere in `src/lib/swing/`. Checked the other two new tickers from the same sweep (AR, UNH) for the same shape: AR has no banked trims yet (Blended/Exec P&L don't co-occur, not buggy there); UNH has no committed position yet (Position section doesn't apply). CAVA was the only one of the three with a fired trim, which is what surfaced this.
