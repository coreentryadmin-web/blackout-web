## Ask Largo swing greek strip rendered a percent-scale IV placeholder as a four-digit percent — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | Ask Largo swing play-brief Position section (`src/lib/swing/play-brief.ts`) + Command Deck greek strip (`src/features/nighthawk/command-deck/PlayTerminal.tsx`) |
| **Severity** | P2 (member-facing data-correctness — a live position's IV can render as a nonsense four-digit percent) |
| **Status** | FIXED |

### Root cause

`normalizeImpliedVol` (`src/lib/providers/options-snapshot.ts`) exists specifically to catch a real
provider placeholder — its own docstring documents that some expired/edge-row option snapshots
return `implied_volatility` on the **PERCENT** scale (`20` meaning `2000%`) instead of the normal
**DECIMAL** scale (`0.20` meaning `20%`), and that every consumer must pass IV through this helper
"at the point IV is displayed." Repo-wide grep before this fix showed **zero call sites** anywhere
in the app: both places that format a held contract's live IV for a member —
`composeSwingPlayBrief`'s Position-section Greeks line (`play-brief.ts`) and the Command Deck's own
greek strip (`PlayTerminal.tsx`'s `fmtGreek`) — formatted the raw provider value straight through
`Math.round(iv * 100)`. A percent-scale placeholder on either surface would have rendered as
`IV 2000%` on a live position instead of the intended `IV 20%`.

### Evidence

`grep -rln "normalizeImpliedVol" src` (excluding the two fixed files and its own definition/test
files) returned nothing before this fix — the guard function existed with no caller. Both consumers
independently reach `ChainContract.iv`/`DeckGreeks.iv` from the same unguarded `snap.iv` origin, so
the same shaped bug shipped twice from one root cause. Live spot-checks of the two currently-open
swing positions (AAPL positionId 37, CRWD positionId 39, both HOLD) via
`GET /api/market/swing/play-brief` show real IV readings (`IV 0%` on a deep-ITM 2DTE AAPL call,
`IV 48%` on CRWD) rendering unchanged post-fix — confirming the guard only rescales the unmistakable
placeholder range and never touches a genuine reading, including a real near-0% one.

### Blast radius

Two call sites, same root cause, both fixed in this PR:
- `src/lib/swing/play-brief.ts` (Position section Greeks line) — imports and calls the real,
  shared `normalizeImpliedVol` from `options-snapshot.ts` directly (already a server-side module).
- `src/features/nighthawk/command-deck/PlayTerminal.tsx`'s `fmtGreek` (the Command Deck's own greek
  strip) — `options-snapshot.ts` is a heavy server-only module (Polygon fetch/rate-limiter chain)
  unsafe to import into this client component, so the same small pure rescale rule
  (`normalizeIvForDisplay`, threshold `iv >= 5` → `/100`) is duplicated locally rather than pulling
  server code into the client bundle. Per `PlayTerminal.tsx`'s own comment, this classic greek strip
  is only reachable today for the LEAPS horizon (ZERO_DTE/SWING both route through
  `commandSinglePanel`'s separate premium-terminal display, `isZeroDtePremiumTerminal`), so LEAPS was
  the live-reachable surface for this specific component; the swing brief fix covers OPEN/HOLD/TRIM
  swing positions directly.

No other consumer of `.iv`/`greeks.iv` was found in the same grep sweep.

### Fix rationale

Both fixes rescale only an unmistakable placeholder (`>= 500%` decimal-equivalent, i.e. raw
`iv >= 5`) — the same threshold `options-snapshot.ts`'s own constant uses — so every real IV
reading, including a genuine near-0% one, passes through completely unchanged; only values no real
option's implied vol ever takes are rescaled. The threshold is duplicated as a literal constant in
`PlayTerminal.tsx` (`IV_DECIMAL_MAX = 5`) rather than imported, deliberately, to avoid pulling the
server-only `options-snapshot.ts` module (Polygon fetch/rate-limiter chain) into the client bundle.

### Tests

Two new tests in `play-brief.test.ts` (percent-scale placeholder rescaled to `IV 20%`, never shown
as `IV 2000%`) and two new tests in `PlayTerminal.ssr.test.ts` (same placeholder-rescale assertion
plus a normal decimal-scale IV rendering unchanged at `49%`).

RED→GREEN proven via `git stash` isolating the two source fixes from their tests: reverting only
`play-brief.ts` + `PlayTerminal.tsx` reproduces exactly 2 failures (the two positive rescale tests,
across both files combined — 117/119 pass); restoring the fix returns both files to fully green
(91/91 in `play-brief.test.ts`, 28/28 in `PlayTerminal.ssr.test.ts`). `npx tsc --noEmit`: clean.
Full `npm test` (Node 20): confirmed green — see PR for exact pass count.
