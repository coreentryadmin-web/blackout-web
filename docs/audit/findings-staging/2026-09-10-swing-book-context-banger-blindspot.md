> **kind:** FINDING

## Ask Largo swing "Book context" concentration check is blind to ~96% of what the Swing board actually shows a member — SCOPED, design proposal not yet built

| | |
|---|---|
| **Status** | SCOPED — design proposal, not yet built |
| **Area** | `bookContextSection` (`src/lib/swing/play-brief-intel.ts`), `checkPortfolioOverlap`/`loadOpenBook` (`src/lib/swing/portfolio.ts`, `src/lib/swing/play-brief-context.ts`), theme resolution (`src/lib/portfolio/sector-map.ts`, `src/lib/swing/theme-cluster.ts`) |
| **Severity** | P2 (Largo/Night Hawk Swings standing ownership mandate — a real, live-confirmed gap in a shipped "does this stack a theme I already hold" feature, not a hypothetical) |

### The finding (live-confirmed against production, not a guess)

Pulled the live Swing board (`GET /api/market/nighthawk/horizons?view=swings`) during this session:
**94 rows shown under `board.lanes.SWING.committed`, 91 LONG / 3 SHORT — a heavily one-sided book by
construction.** This is exactly the shape "Book context" exists to flag.

Checked how many of those 94 rows are actually **real `swing_positions` DB rows** (the only book
`bookContextSection`'s `checkPortfolioOverlap` ever sees, via `loadOpenBook()` ->
`fetchOpenSwingPositions()`) versus **Banger-engine rows merged into the same UI lane** for display
(`banger-lane-merge.ts`) — the discriminator is `positionId`, present only on genuine swing ledger rows:

**Only 4 of 94 (4.3%) carry a real `positionId`. The other 90 (95.7%) are Banger-lane merges with no
`positionId` at all** (confirmed directly on two of them, DDOG/NET, whose `reason` field literally
reads `"Banger breakout +7.8%..."` / `"Banger breakout +6.3%..."` — unambiguous banger provenance).

Pulled the live brief for `SWING:CRWD` (a REAL swing position, `positionId: 19`, LONG) — its own
board neighbors `DDOG` and `NET` are the same "software" theme cluster (`resolveTheme`) and same
direction (LONG), which is precisely what `bookContextSection`'s `sameThemeSameDirection` branch is
built to flag as **"Concentration"**. The live brief's `envelope.sections` carried **no "Book context"
section at all** — because `DDOG`/`NET` are Banger rows, invisible to `fetchOpenSwingPositions()`,
so `checkPortfolioOverlap` never sees them as part of CRWD's book. Re-ran the same theme/direction
clustering restricted to ONLY the 4 genuine swing rows: **zero same-theme+same-direction pairs exist
among them** — so today, live, in production, **"Book context" cannot render for ANY currently open
swing position**, not due to a clean/diversified book, but because the book it actually checks against
is a 4-row remnant of the 94-row book the member is looking at on screen.

### A second, independent, smaller factor — worth naming even though it isn't the dominant cause here

Separately confirmed `sectorFor` (`src/lib/portfolio/sector-map.ts`) — the theme resolver
`bookContextSection` reuses — is a curated ~110-ticker map built for "**the liquid, high-flow options
universe the 0DTE board actually surfaces**" (the file's own docstring), not swing's actual candidate
universe. Running `resolveTheme` over the full live 94-ticker Swing book: **82 of 94 (87.2%) resolve
to their own private `NAME:` cluster** — including `NRG`, whose own live Ask Largo brief in this same
session cited a real "Nvidia Warns Of AI Power Bottleneck — And Bloom Energy Could Benefit" headline,
i.e. NRG is a genuine AI-power-demand name that arguably belongs beside the map's own `"ai-power"`
bucket (`VST, CEG, NEE, GEV, OKLO, SMR, ASTS`) but isn't in it. This means even a hypothetical fix to
the banger-blindspot above would still under-detect real thematic concentration among swing-typical
small/mid-cap momentum names, because the shared sector map was curated for a different engine's
universe. **Not the primary fix target this pass** (the 90/94-row blindspot dominates), but the same
follow-up PR (or a documented decision not to) should account for it, or the "fix" will look complete
while still missing most real overlaps.

### Why this isn't a small, obvious patch (same shape of decision as #4679's finding, different mechanism)

Whether Banger-lane positions **should** count toward Swing's own "Book context" concentration check
is a genuine product question, not an implementation bug with one right answer:

- **For inclusion**: a member reading the Swing board sees ONE merged list of 94 "my swing
  positions" — Ask Largo's own "Book context" section, read against a swing PICK, is implicitly
  promising to weigh that against the visible book. Checking only 4 of it silently under-delivers on
  that promise, and the gap is largest exactly when concentration risk is largest (a heavily
  one-sided book).
- **Against inclusion**: Banger and Swing are different engines with different exit/gate logic
  (per `docs/audit/findings-staging/2026-09-10-swing-thesis-health-committed-position-wiring-gap.md`'s
  independent finding on the SAME merge boundary — Banger rows there hardcode taxonomy fields the real
  swing commit gate never sets). If Banger risk is deliberately managed/sized separately from Swing
  risk (a real possibility — the two lanes may have independent position-sizing and risk budgets), then
  folding Banger tickers into Swing's own concentration math could produce a MISLEADING "you're
  overconcentrated in software" warning on a Swing pick when the actual Swing-only risk is fine and the
  Banger exposure is sized/managed on its own separate budget. Fabricating a cross-engine concentration
  read without knowing whether risk is actually shared would be exactly the kind of invented-certainty
  problem `docs/audit/LARGO-PRODUCT-CONTRACT.md` warns against.

Given that ambiguity — and given this repo's own very recent, closely analogous finding
(`2026-09-10-swing-thesis-health-committed-position-wiring-gap.md`) already investigated the identical
Banger/Swing merge boundary and concluded the "obvious" cross-engine fix rested on a false premise —
this is scoped as a design question for Cursor/operator sign-off, not implemented unilaterally.

### Options considered

| Option | What it does | Why not chosen (this pass) |
|---|---|---|
| A — feed `bookContextSection` the SAME merged 94-row book the UI shows (include Banger rows) | Closes the blindspot completely, matches what the member visually sees | Requires a product decision on whether Banger and Swing risk are meant to be read as one book; `positionId`-less rows also can't be `excludePositionId`-filtered the same way, so the "exclude the play under review" logic needs rework too |
| B — leave Book context Swing-only, but label the section honestly (e.g. "no overlap among your N real Swing positions" vs. silently omitting the section) | No cross-engine risk-merging decision needed; smaller change | Still under-informs on real concentration risk if the operator's mental model of "my book" already includes Banger; also doesn't fix the sector-map narrowness |
| C — widen `sectorFor`'s curated map to explicitly cover swing's actual candidate universe (starting with observed gaps like `NRG`) | Independently useful regardless of A/B | Doesn't touch the 90/94-row blindspot, which is the dominant factor measured here; worth doing but insufficient alone |
| (Recommended) Raise both findings together for a single product decision | Same underlying Banger/Swing merge boundary as the sibling thesis-health finding — a combined sign-off avoids two separate, possibly-conflicting decisions about the same boundary | — |

### Recommendation

Do not implement A, B, or C unilaterally this pass. Raise this alongside the sibling
thesis-health finding (same Banger/Swing merge boundary, same root question: "how much of Banger's
merged presence in the Swing lane should Swing's own intelligence layer see and reason about") on the
standing #4076 collaboration thread for Cursor/operator input. If the answer is "yes, unify the risk
view" (Option A), the smallest safe first step is probably widening `loadOpenBook()` to also read
Banger's live positions table (need to confirm its schema exposes ticker+direction the same way) and
reworking the position-exclusion key to something that works for a `positionId`-less row (ticker+
direction+contract, most likely) before touching `checkPortfolioOverlap` itself. If the answer is
"no, keep them separate" (Option B), the smallest safe step is just making the current 4-row scope
explicit in the UI/copy rather than silently rendering nothing.

### Blast radius (confirmed, so a follow-up doesn't have to re-derive this)

- `bookContextSection` has exactly one production call site: `play-brief-intel.ts` line ~843
  (`const book = bookContextSection(play, ctx.openBook);`) — grepped repo-wide, no other call sites.
- `loadOpenBook()` (`play-brief-context.ts`) is the only place `ctx.openBook` is populated, and it
  calls `fetchOpenSwingPositions()` exclusively — no Banger-table read anywhere in this path.
- `resolveTheme`/`sectorFor` are also imported by the Allocation Engine (per `sector-map.ts`'s own
  docstring: "the Allocation Engine's duplicate-thesis clustering") — widening the map (Option C)
  would affect that engine's clustering too, which is very likely fine (same underlying risk-grouping
  intent) but should be verified, not assumed, before a follow-up PR touches it.
- Not touched, not in scope: `banger-lane-merge.ts`'s hardcoded `setupState`/`entryStatus` (that's the
  sibling finding's territory), `checkPortfolioOverlap`'s own matching logic (confirmed correct given
  its actual inputs — the bug is entirely in what book gets fed to it, not how it compares), and
  `sectorFor`'s existing curated entries (none are wrong, the map is just narrower than swing's real
  universe).

### Evidence trail (reproducible)

- `GET /api/market/nighthawk/horizons?view=swings` (authenticated, temp Clerk premium session): 94
  committed rows, 91 LONG / 3 SHORT, 4 with a real `positionId`.
- `GET /api/market/swing/play-brief?playId=SWING:CRWD&ticker=CRWD&positionId=19`: live envelope
  section list confirmed to omit "Book context" despite CRWD/DDOG/NET sharing theme("software")+
  direction(LONG) per `resolveTheme`.
- Direct import + call of `resolveTheme` (`src/lib/swing/theme-cluster.ts`) over the full live
  94-ticker book: 82/94 resolve to an own-cluster (`NAME:<ticker>`); of the 12 that share a named
  cluster with at least one other ticker, restricting to the 4 rows with a real `positionId` leaves
  zero same-theme+same-direction pairs.
