> **kind:** `FINDING`

## Ask Largo swing brief's "What changed" diff fired a content-free "Verdict headline updated" line on a pure DTE-countdown tick — FIXED

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Area** | Night Hawk Swings / Ask Largo play-brief diff engine (`src/lib/swing/play-brief-diff.ts`) — found via the Ask Largo standing mandate's continued swing deep-dive |
| **Severity** | P2 (the diff engine's ONE rule that names no before/after value — and it can fire as the sole line in the entire "What changed"/narrative pulse, telling a member "something changed" with zero information on what) |
| **PR** | fix/swing-diff-headline-dte-noise |

### Root cause

`diffBriefSnapshots`'s headline-change check (`if (prev.headline !== next.headline)
lines.push("Verdict headline updated")`) compares the raw headline string
(`${action?.label ?? play.recommendation ?? play.status} — ${playContractHeadline(play)}`,
`play-brief.ts:853`). `playContractHeadline` (`play-card-lifecycle.ts:556-558`) returns
`playSymbolLine(play)`, which is `${play.ticker} ${leg}` — and `leg` derives from `play.contract`,
which bakes in the contract's own DTE (documented example: "INTC 90P 4DTE"). DTE decrements every
session day on its own, with nothing else about the position necessarily moving — so on a quiet
refresh across a day rollover, this check fired unconditionally, and unlike every OTHER diff rule in
the file (which all name a concrete before/after value), this one produced zero information: no old
value, no new value, no reason. Worse than the other restatement bugs fixed today, because this line
can be the ONLY line in the entire "What changed" pulse.

Every other diff rule in `diffBriefSnapshots` was checked and confirmed to already name a concrete
before/after value — this headline check was the sole exception.

### Evidence

- `play-brief.ts:853`: confirmed `playContractHeadline(play)` feeds the raw headline string.
- `play-card-lifecycle.ts:549-558`: confirmed `playSymbolLine`/`playContractHeadline`'s doc comment
  gives the exact example "INTC 90P 4DTE" — DTE is baked into the string these functions return.
- Pre-fix `diffBriefSnapshots`: confirmed the bare `prev.headline !== next.headline` comparison,
  grep-verified against the diff.

RED→GREEN proof (independently reproduced on a fresh `fix/swing-diff-headline-dte-noise` branch off
actual latest `origin/main`, post #5204/#5205's merges):
- Reverted `play-brief-diff.ts` via `git stash push -- <file>`, kept the new test. `npx tsx
  --experimental-test-module-mocks --test src/lib/swing/play-brief-diff.test.ts`: **1 failure**
  (the new test) — 31/32 pass.
- Restored (`git stash pop`). Re-ran: **32/32 pass**.
- Broader sweep (all `play-brief*.test.ts` files): **642/642 pass**.
- `npx tsc --noEmit -p .` on Node 20: clean.

### Blast radius

Single-file fix: `diffBriefSnapshots`'s headline-change rule only. Every other diff rule in the
file (recommendation change, roll-watch clearance, thesis/spot/P&L/recommendation shifts, etc.)
already names a concrete before/after value and is untouched.

### Fix rationale

Minimal, targeted: added `stripDteFromHeadline()`, which strips the trailing `"<N>DTE"` token
before comparing. A pure DTE-only change no longer fires the line at all — the "Hold plan" section
already surfaces live DTE continuously, so restating "the DTE changed" here would itself be a
second restatement, not new information. A headline change from any OTHER cause (a roll changing
strike, an action-label shift not already captured by the recommendation-change rule) still fires,
since those genuinely are new facts.

### Verification

Independently re-verified from scratch on a fresh branch off actual latest `origin/main` (post
#5204/#5205's merges) — not the originating research agent's own working-tree state. The claimed
DTE-baked-headline chain (`play-brief.ts:853` → `playContractHeadline` → `playSymbolLine` →
`play.contract`) was independently grep-verified at each hop; RED/GREEN reproduced independently
via `git stash`; broader `play-brief*.test.ts` sweep (642/642) and `tsc --noEmit` both clean.
