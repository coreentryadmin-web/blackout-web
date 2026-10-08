## 2026-10-08 — [FINDING, largo-ui] Command Deck's Swing "Thesis Monitor" rendered "✓ thesis intact" for Banger-origin positions off the same hardcoded constant #5693 fixed in Ask Largo's play-brief narrative, but in a DIFFERENT consumer — FIXED

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P2 (member-facing UI honesty — a green "thesis intact" badge sat next to -59.1%/-56.1%/-55.9%/-52.5% P&L on the live Command Deck for the majority of the committed Swing book) |
| **Component** | `src/features/nighthawk/command-deck/adapters.ts` (`terminalPlayFromHorizon`'s `thesisBreakResolved`) |
| **PR** | fix/swing-banger-thesis-intact-command-deck |

### Root cause

Same stamped-constant root cause as PR #5693 ("Ask Largo swing play-brief rendered 'Thesis
intact' for Banger-origin positions off a hardcoded constant"), different consumer, found during
this cycle's standing instruction to verify #5693's fix is holding across the Banger-origin book.

`horizonPlayFromBangerPosition` (`src/lib/swing/banger-lane-merge.ts`) stamps
`thesisLevel: "intact"` as a fixed literal on **every** Banger-origin merged Swing position
regardless of price action — there is no per-position thesis dossier for this lane, just one
mechanical price trigger (the function's own header comment). #5693 fixed the ONE place that
literal reached Ask Largo's play-brief narrative (`watchForSection`, `play-brief-intel.ts`) by
suppressing the line when `play.regime === BANGER_LEDGER_REGIME_LABEL`.

It never touched the **Command Deck UI** itself. `containers.tsx` builds each `TerminalPlay` by
calling `terminalPlayFromHorizon` with `thesisBreak: p.thesisLevel != null ? { level:
p.thesisLevel, note: p.thesisNote } : undefined` — forwarding the API's `thesisLevel` field
straight through. Inside `terminalPlayFromHorizon`, `thesisBreakResolved` resolved as
`src.thesisBreak ?? thesisBreakFromSetupState(...)` — since `src.thesisBreak` was always non-null
for a Banger row (its hardcoded `"intact"`), the honest `thesisBreakFromSetupState` fallback (which
already returns `"unknown"` for a genuinely data-absent read, exactly the state this lane is in)
was never reached. `PlayTerminal.tsx`'s `ThesisPanel` then renders `play.thesisBreak.level` almost
verbatim: `level === "intact"` → `<span className="ok">✓ thesis intact</span> — {monitorNote}`,
with no Banger-regime guard of its own.

Live repro (`GET /api/market/nighthawk/horizons?view=swings`, 2026-10-08): of 80 committed SWING
rows, every one of the ~78 Banger-origin rows (`signalKinds: ["BANGER"]`, `regime: "BREAKOUT ·
BANGER"`) carried `thesisLevel: "intact"` regardless of `livePnlPct` — including
`SWING:CRI:1510` at **-59.1%** P&L (`thesisNote: "below the 2× partial and above the hard stop"`),
`SWING:GLW:1479` at **-56.1%**, `SWING:NEBX` at **-55.9%**, `SWING:MTSI` at **-55.9%**,
`SWING:AI` at **-52.5%**, `SWING:EROC`/`SWING:NOK` at **-50%** — every one rendering the identical
green "✓ thesis intact" badge in the Command Deck's Swing panel. 78/81 of the live committed Swing
book is Banger-origin (CLAUDE.md), so this was the dominant rendered state of the lane's own
thesis-health line, not an edge case.

### Blast radius

Checked both reachable call sites of `terminalPlayFromHorizon`:
- `containers.tsx` (the live Command Deck board render) — the one this finding fixes.
- The closed-position path (`terminalPlayFromClosedSwing`, line ~1401) passes its own
  `thesisBreak` built independently from `closedReason`/`exitPnlPct`, not from a WATCH/COMMIT
  `thesisLevel` field, so it was not exposed to this bug — verified by reading its call site rather
  than assumed.

Not a duplicate of #5693's fix location (`play-brief-intel.ts`'s `watchForSection` already has its
own, separate guard) — this is the sibling surface #5693's own write-up did not claim to cover.

### Fix

Added the identical sentinel check `thesisHealthUncalibrated()` (thesis-health.ts) and #5693 both
already use — `regime === BANGER_LEDGER_REGIME_LABEL` — at the single chokepoint
(`thesisBreakResolved` in `terminalPlayFromHorizon`) that every Command Deck consumer of
`TerminalPlay.thesisBreak` reads, rather than patching `containers.tsx`'s inline construction
(which would only cover that one call site and re-create the exact "fixed one consumer, missed the
sibling" gap this finding is reporting). When the sentinel matches, the level is overridden to
`"unknown"` — an existing, already-rendered honest state ("• thesis not monitored") — while the
real mechanical `note` (e.g. "below the 2× partial and above the hard stop") is kept, since that
part is genuine, useful information; only the misleading green "intact" claim is suppressed. A
native (non-Banger) position's real `thesisBreak` read is untouched — proven by a same-test
assertion using an identical P&L (-59.1%) and `level: "intact"` but a real `regime` string, which
must still render `"intact"`.

### Evidence

RED→GREEN verified via `git stash` (stashing only the `adapters.ts` fix, keeping the new test):
pre-fix the new assertion failed (`actual: 'intact'`, `expected: 'unknown'`); post-fix
`adapters.test.ts` passes 153/153. Full related suite
(`thesis-health.test.ts` + `serving-lane.test.ts` + `play-brief-intel.test.ts` + `play-brief.test.ts`
+ every `command-deck/*.test.ts`) passes 815/815. `tsc --noEmit` clean. Full `npm test`: 15796
passed / 0 failed / 3 skipped (pre-existing, unrelated).

### Market-open validation

See `docs/audit/MARKET-OPEN-VALIDATION.md` — check a real Banger-origin Swing position with a
material loss on the live Command Deck (`/nighthawk`, Swings tab) during RTH: the Thesis Monitor
panel should read "• thesis not monitored" (amber), never a green "✓ thesis intact", while the
mechanical note (2× partial / hard stop framing) still prints underneath it.
