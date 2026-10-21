## bookContextSection's same-direction 'Concentration' branch never sharpened a literal same-ticker duplicate, unlike the already-fixed opposed-direction sibling — FIXED

> **kind:** `FINDING`

| **Status** | Fixed |
|---|---|

**Found:** 2026-10-21, Ask Largo standing mandate — a Workflow-based deep-dive (live-fetched real
swing play-brief envelopes across WATCH/OPEN/CLOSED buckets, adversarially verified before acting)
focused on "Book context", not yet audited this session.

**Root cause:** `bookContextSection`'s same-direction ("Concentration") branch
(`src/lib/swing/play-brief-intel.ts`) rendered every overlapping row — whether a genuinely
different name in the same sector theme or the LITERAL SAME TICKER as the reviewed play — with
identical generic "theme X" framing. `describeThemeOverlap` only sharpens to "the same name
(TICKER)" when the candidate's resolved theme ITSELF is an own-cluster sentinel (no other ticker
shares it) — it does not detect a same-ticker row sitting INSIDE a real, multi-name theme (e.g.
"healthcare", "semis"). The OPPOSED-direction branch a few lines below already special-cased this
exact shape (fixed 2026-10-20, live TSLA repro) by filtering `overlap.sameThemeOpposedDirection`
into same-ticker vs other-ticker sub-lists and giving the same-ticker case a separate, louder
"Internal conflict — same underlying ... This is the identical name, not just the same sector"
sentence — the same-direction branch had no equivalent split. `portfolio.ts`'s own design-intent
comment explicitly calls two independent same-ticker/same-direction positions "the most extreme
concentration case this function exists to catch," yet the rendering flattened it to ordinary
cross-ticker sector concentration.

**Evidence:** Two live envelopes reproduce it directly. (1) MRNA TRIM (positionId 1958): "Book
context" read "**Concentration** — already holding 1 same-direction position in theme
'healthcare': MRNA LONG (separate position #1969). MRNA stacks the same wager rather than
diversifying risk." — the ENTIRE "theme overlap" here was a second, independently-committed MRNA
LONG position, not a different healthcare name. (2) CRWV HOLD (positionId 63): "...already holding
3 same-direction positions in theme 'semis': ON LONG, NBIS LONG, CRWV LONG (separate, cross-engine
position #1968)..." — CRWV (the ticker under review) was buried as one of three names with no
distinguishing framing from the two genuinely different names (ON, NBIS).

**Fix:**
- `src/lib/swing/play-brief-intel.ts` — `bookContextSection`'s same-direction branch now filters
  `overlap.sameThemeSameDirection` into same-ticker vs other-ticker sub-lists (mirroring the
  opposed branch's own established split exactly) and renders a separate "**Concentration — same
  underlying**" sentence for the same-ticker rows, preserving the pending-entry-vs-already-
  committed tense distinction (`isPendingEntryDecision`) the generic sentence already carried.
- `src/lib/swing/play-brief.ts` — `evidenceFromContext`'s "Book overlap:" evidence-fact mirror
  (the same Largo C7 evidence-matching duplication pattern fixed earlier this session for
  sibling-count) hand-built the identical generic "theme X" framing off the same
  `overlap.sameThemeSameDirection` array — fixed with an analogous, terser same-ticker/other-
  ticker split so the structured evidence fact can't disagree with the section body about the same
  underlying overlap.

**Tests:** `src/lib/swing/play-brief-intel.test.ts` — two new tests (pure same-ticker duplicate
renders only the sharper sentence with no generic theme framing; a mixed same-ticker +
genuinely-different-name overlap renders BOTH sentences, each scoped to only its own rows) plus
corrected three pre-existing tests whose assertions had encoded the old generic framing for
fixtures that were, on inspection, actually same-ticker/same-direction cases (an own-cluster
BYND test, a bare cross-engine-label test, and a WATCH-tense test) — each correction explains why
the old assertion no longer discriminates and what it now verifies instead.
`src/lib/swing/play-brief.test.ts` — corrected the analogous evidence-fact BYND test. Full suite:
`play-brief-intel.test.ts` 297/297 pass, `play-brief.test.ts` 159/159 pass. RED→GREEN proven via
`git stash` on both source files (4 fail / 452 pass without the fix, 456/456 with it). `tsc
--noEmit` clean.

**Blast radius:** `bookContextSection` (same-direction branch only — the opposed branch and every
other section untouched) and `evidenceFromContext`'s "Book overlap:" fact (the one call site of
this duplicated root cause outside `bookContextSection` itself, per this repo's standing PR policy
to fix and note every consumer of the same root cause, not just the one first tripped over). A
side effect worth naming: with this fix, `describeThemeOverlap`'s own-cluster-sentinel-to-name
resolution (`theme-cluster.ts`) becomes unreachable in production for BOTH the same-direction and
opposed-direction branches (an own-cluster theme is, by construction, ticker-unique, so the
"other-ticker" sub-list can never be non-empty under one) — a natural, positive consequence (the
sharper same-ticker sentence now supersedes it earlier), not something this PR removes or further
modifies.
