> **kind:** FINDING

## Swing "Desk context" attributes Night Hawk Legacy's pick history to the swing engine itself — FIXED

| **Status** | FIXED |
|---|---|

**What was broken (live production, found during the standing Ask Largo deep-dive):** `deskConsensusSection`
(`src/lib/swing/play-brief-intel.ts`) renders a "Desk context" section inside every swing play-brief with the
wording `Night Hawk's last swing on this name (**{edition_for}**) {verdict} {tail}`. Live on GOOG's WATCH
brief this read: *"Night Hawk's last swing on this name (2026-08-03) is still unresolved — weigh that track
record against today's SHORT setup before sizing."*

The data behind it (`eco.nighthawk_recent`, confirmed by the `edition_for` field name — Legacy's own
vocabulary for its next-day digest) is **Night Hawk Legacy's pick history on this ticker**, a completely
separate product from the Swing engine. But inside a document that is *itself* a "Swing" play brief, the
phrase "Night Hawk's last swing on this name" reads naturally as "this same engine's own prior position on
this name" — a member has no way to tell from the wording alone that it's describing a different product's
outcome history, not the Swing engine's own track record on the ticker.

This is the sibling gap to the "Night Hawk Legacy absence chip" fix shipped earlier tonight
(`fix/swing-brief-legacy-stale-ticker-misclaim`, staged finding
`2026-09-10-swing-brief-legacy-stale-ticker-misclaim.md`) — same underlying `nighthawk_recent` data source,
same cross-product confusion, but that fix addressed the absence CHIP (`unavailableSources`); this addresses
the section that actually NARRATES the data when present.

**What changed:** The wording now reads `Night Hawk Legacy's last pick on this name (**{edition_for}**)
{verdict} {tail}` — unambiguous product attribution, no other change to the section's logic (the
unresolved/closed verdict branching, the closed-bucket "for reference against" reframing, all untouched).

**Blast radius:** Contained to `deskConsensusSection`'s one rendered string. Grepped `nighthawk_recent` and
the literal phrase "Night Hawk's last swing" repo-wide: the phrase is unique to this one call site. Other
`nighthawk_recent` consumers (`src/lib/bie/ticker-compare.ts`, `ecosystem-narrative.ts`, `ticker-verdict.ts`,
`src/lib/swing/play-brief-narrative-coaching.ts`/`play-brief-narrative.ts`) live in the shared BIE narrative
layer (serves multiple products, not swing-specific) or use a different helper (`nighthawkLiveForSession`)
and different wording entirely — out of scope for this swing-lane fix, not touched.

**Tests:** New regression test in `play-brief-intel.test.ts` — `deskConsensusSection: attributes the outcome
history to Night Hawk LEGACY, not the Swing engine itself` — asserts the corrected wording appears and the
old ambiguous wording does not. RED→GREEN proven via `git stash` isolating the source fix from the test (1
fail pre-fix / 0 fail post-fix, 81/81 in file). Full `src/lib/swing` suite: 940/940 pass. `tsc --noEmit`:
clean.
