> **kind:** `FINDING`

## Ask Largo swing brief disclosed ticker-news staleness in the narrative but never in `unavailableSources` — the `UnavailableChip` UI never saw it — FIXED

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Area** | Ask Largo swing play-brief — `collectBriefUnavailableSources` (`src/lib/swing/play-brief-absence.ts`) — found via the Ask Largo standing mandate's continued swing deep-dive |
| **Severity** | P3 (a real, already-computed staleness signal reached one member-facing surface but not its sibling — the same absence-disclosure principle `docs/audit/LARGO-PRODUCT-CONTRACT.md` names) |
| **PR** | fix/swing-news-catalyst-staleness-chip |

### Root cause

`#5166` (merged earlier today) added `newsCatalystStale`/`newsCatalystAgeMs`
(`play-brief-absence.ts`) and wired them into the narrative's Headlines section
(`catalystsSection`, `play-brief-intel.ts:776`) so a stale `arsenal.news.as_of` read prefixes the
headlines with a "Last snapshot (~Ns old) — headlines may lag" line. That fix stopped one level
short of parity with its own stated model: every OTHER freshness signal in this file (Meridian
catalyst staleness, option-mark staleness, GEX staleness, Vector staleness) reaches BOTH the
narrative prose AND `collectBriefUnavailableSources`'s `unavailableSources` array — the one field
the UI's dedicated `UnavailableChip` component reads from. News-catalyst staleness reached only the
narrative. A member who skims the chip row (rather than reading the full narrative body) had no way
to know the headlines they're looking at could be up to `NEWS_CATALYST_STALE_MS` (2 minutes —
`NEWS_CATALYST_STALE_MS = GEX_MATRIX_STALE_MS = VECTOR_STALE_MS = 120_000`) old.

This is the same "independently-derived-verdict pair" shape flagged elsewhere today (#5205's
`lessonsSection`/Trade-manager-read duplication, #5208's diff-engine headline check) — two places
compute the same fact and only one got updated when the underlying signal was added.

### Evidence

- `play-brief-absence.ts`: `newsCatalystStale`/`newsCatalystAgeMs` (lines ~191-211) confirmed, via
  grep, to have zero call sites in `collectBriefUnavailableSources` prior to this fix — the only
  call site was the narrative's own `play-brief-intel.ts:776`.
- Sibling parity check: `meridianCatalystStale` (the pattern this fix mirrors) confirmed via grep to
  already reach `unavailableSources` via an `out.push(...)` at `play-brief-absence.ts:581`,
  immediately above where the news-catalyst check was added.

RED→GREEN proof (independently reproduced on a fresh `fix/swing-news-catalyst-staleness-chip`
branch off actual latest `origin/main`, post #5204/#5205/#5208's merges):
- Reverted `play-brief-absence.ts` via `git stash push -- <file>`, kept the 4 new tests. `npx tsx
  --experimental-test-module-mocks --test src/lib/swing/play-brief-absence.test.ts`: **1 failure**
  (the new stale-news chip test) — 67/68 pass.
- Restored (`git stash pop`). Re-ran: **68/68 pass**.
- Broader sweep (all `play-brief*.test.ts` files): **644/644 pass**.
- `npx tsc --noEmit -p .` on Node 20: clean.

### Blast radius

Single call site (`collectBriefUnavailableSources`), single new `unavailableSources` entry value
(`"Ticker news"`) — no other consumer needed changes; `UnavailableChip` already renders whatever the
array contains generically. The narrative's own inline "Last snapshot... may lag" prefix is
untouched — it stays as the detailed explanation; the new chip entry is the at-a-glance signal for
a member who never opens the full narrative.

### Fix rationale

Minimal, targeted: added a parallel staleness check in `collectBriefUnavailableSources`, mirroring
`meridianCatalystStale`'s existing pattern exactly — same `!isClosed` gate (a closed play's
headlines-at-the-time citation is historical, not "may lag"), same headlines-present guard the
narrative branch already uses (staleness of an empty headline list is meaningless). Did not touch
`NEWS_CATALYST_STALE_MS`/threshold value (unrelated to this gap) or any other `unavailableSources`
entry.

### Verification

Independently re-verified from scratch on a fresh branch off actual latest `origin/main` (post
#5204/#5205/#5208's merges) — not the originating research agent's own working-tree state. The
claimed pre-fix call-site asymmetry (news-catalyst staleness narrative-only vs. Meridian-catalyst
staleness reaching both surfaces) was independently grep-verified at each cited location;
RED/GREEN reproduced independently via `git stash`; broader `play-brief*.test.ts` sweep (644/644)
and `tsc --noEmit` both clean.
