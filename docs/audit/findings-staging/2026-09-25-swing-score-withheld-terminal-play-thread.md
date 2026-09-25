## `scoreWithheld` never reached `adapters.ts`/`TerminalPlay` — Command Deck and future consumers had no way to tell a withheld `score:0` from a real one — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | Ask Largo / Night Hawk Swings — Command Deck score display, defense-in-depth |
| **Severity** | P3 (member-facing display correctness during a real but transient staleness window — no trading-path/gate change) |
| **Status** | FIXED |
| **Files** | `src/features/nighthawk/command-deck/types.ts`, `adapters.ts`, `containers.tsx`, `PlayTerminal.tsx`, `src/lib/swing/play-brief-resolve.ts` |

### Root cause

Live audit found `SWING:AAPL:40` briefly showed `score: 0` on the board while its "Why this
setup" pillars summed to `75.9` — a direct violation of the codebase's own documented and tested
invariant (`live-plays.test.ts:603`, "a live play's factors must sum to exactly its own score").
Traced to `live-plays.ts`: `score = evidenceScore ?? 0` reads `row.feature_vector.evidence_score`,
which was transiently missing on this row while the separate `pil_*` fields (independently used by
`pinnedFactorsFromFeatureVector` to reconstruct `factors`) survived — producing a real `0`-vs-`75.9`
split. `HorizonPlay.scoreWithheld` already exists to flag exactly this (`evidenceScore == null`,
added 2026-09-21 per `play-brief-lane-rank.ts`'s own fix comment, whose live repro was this same
`SWING:AAPL:40` row) — but that fix only wired the flag into lane-rank peer comparison. A repo-wide
grep before this fix showed `scoreWithheld` read by exactly three files: `horizon-plays.ts` (the
type), `live-plays.ts` (where it's computed), and `play-brief-lane-rank.ts` (the one consumer).
`adapters.ts`'s `HorizonDeckSource`/`terminalPlayFromHorizon` — the ONE shared builder feeding both
the Command Deck UI and (via `play-brief-resolve.ts`) Ask Largo's play-brief — never received it,
so `TerminalPlay.score` was the raw fallback `0` with no disclosure anywhere outside the single
already-fixed lane-rank call site.

Independently re-verified ~45 minutes after the original live repro (with a second, concurrent
Claude session cross-checking): the specific row had already self-healed (`scoreWithheld: true,
factors: []` correctly, matching the `swing-active-refresh` cron's next tick most likely re-fixing
`feature_vector`). So the underlying data issue is transient, not a permanent bad row — this fix is
purely the missing defense-in-depth: the next time this window opens (or any future consumer reads
`TerminalPlay.score`), the flag is there to check.

### Evidence

Live repro captured in `#4076` comment thread (2026-09-25 ~10:35 UTC): `GET
/api/market/nighthawk/horizons?view=swings`'s `AAPL:40` row carried `score: 0`; the same row's
`GET /api/market/swing/play-brief?playId=SWING:AAPL:40` "Why this setup" section showed real
pillars (Structure +34, Catalyst +23, Regime +18.9 = 75.9). Re-checked live ~11:22 UTC: both routes
now correctly show `scoreWithheld: true` / empty factors / the honest "No pillar breakdown on this
row — grade is from lane score only" fallback text — confirming the transient-staleness diagnosis.

### Fix

Added `scoreWithheld?: boolean` to `TerminalPlay` (types.ts) and `HorizonDeckSource` (adapters.ts),
threaded through `terminalPlayFromHorizon`'s `score:`/`scoreWithheld:` construction, and wired both
call sites that build `HorizonDeckSource` from a `HorizonPlay` (`containers.tsx`'s live board
assembly, `play-brief-resolve.ts`'s `horizonRowToDeckSource`) to pass the upstream flag through.
Guarded the two UI spots in `PlayTerminal.tsx` that render `play.score` as raw text: the Command
Deck header score badge now shows `"—"` instead of a misleading `0` when withheld, and the "Why
this play was picked" empty-factors fallback distinguishes "withheld" (honest, matches the
play-brief's own fallback text) from "not served for this lane yet" (the pre-existing, unrelated
case — e.g. Legacy editions without a pinned factor breakdown).

Regression test added (`adapters.test.ts`): RED confirmed pre-fix (`git stash` on `adapters.ts`
alone) — `scoreWithheld` didn't survive the `terminalPlayFromHorizon` call; GREEN post-fix, plus a
sibling case proving a genuinely-scored `0` (no `scoreWithheld` on the source) stays unflagged, so
this can never suppress a real low score. `tsc --noEmit` clean; 339/339 collateral tests pass
across `adapters.test.ts`, `PlayTerminal.ssr.test.ts`, `play-brief-resolve.test.ts`,
`play-brief.test.ts`, `entry-verdict.test.ts`, `serving.test.ts`.

### Blast radius

`terminalPlayFromHorizon` is the one shared builder for SWING/LEAPS rows (0DTE/Legacy use their
own adapters and have no `scoreWithheld` concept) — both live call sites that construct its input
(`containers.tsx` for the Command Deck, `play-brief-resolve.ts` for Ask Largo) now forward the
flag, so both UI surfaces are covered by this one fix.
