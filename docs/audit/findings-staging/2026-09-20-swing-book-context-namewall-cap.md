> **kind:** FINDING

## Ask Largo — Swing "Book context" section dumps every overlapping ticker with no cap — FIXED

| | |
|---|---|
| **Area** | `src/lib/swing/play-brief-intel.ts` (`bookContextSection`) |
| **Status** | FIXED |
| **Severity** | P3 — narrative-quality gap, no data-correctness impact |
| **Found via** | Ask Largo × Night Hawk Swings standing ownership mandate (`CLAUDE.md`) live deep-dive, `GET /api/market/swing/play-brief` |

### Root cause

`bookContextSection` builds its "Concentration" sentence by `.map(formatOverlapPosition).join(", ")`
over the FULL `overlap.sameThemeSameDirection` array with no length limit. Every prior fix to this
function (2026-09-06 → 2026-09-18, all in `FINDINGS.md`) disambiguated INDIVIDUAL name collisions —
self-citation, cross-engine siblings, a duplicate ticker mid-list — but none of them bounded how many
names get joined into one sentence.

Live-confirmed on BKKT (2026-09-20, real production `GET /api/market/swing/play-brief?playId=SWING:BKKT:1221`):
the "Book context" section read *"already holding 28 same-direction positions in theme 'crypto-equity':
ABTC LONG, GEMI LONG, ETHE LONG, BLSH LONG (separate, cross-engine position #1216), ETH LONG, SBET LONG,
GLXY LONG, GBTC LONG, MSTX LONG (separate, cross-engine position #1209), BTDR LONG, ETHU LONG, BITX LONG,
MSTU LONG, CLSK LONG, RIOT LONG, HUT LONG, BITO LONG, MARA LONG, ETHA LONG, BMNR LONG, IREN LONG,
IBIT LONG, COIN LONG, MSTR LONG, ABTC LONG (...), BLSH LONG (...), BLSH LONG (...), MSTX LONG (...)."*
— one unbroken 28-ticker comma-separated wall. This is exactly the "bullet-dump instead of trade-manager
voice" failure mode the Largo product contract's narrative principle exists to prevent: a trader cannot
usefully scan a 28-name sentence, and the names that would matter most (a duplicate/cross-engine sibling
on THIS ticker) are buried with no more prominence than the 20th unrelated name.

### Blast radius

Single function, both branches (`sameThemeSameDirection` "Concentration" and `sameThemeOpposedDirection`
"Internal conflict" — the second is structurally identical and would hit the same wall in a big enough
opposed-direction book, even though it hasn't been observed live yet at this length).

### Fix

Added `MAX_OVERLAP_NAMES = 8` and a `joinOverlapNames()` helper: renders the first 8 formatted names,
folds the rest into `+ N more`. The lead sentence's own count (`overlap.sameThemeSameDirection.length`)
already states the TRUE total honestly before the name list — nothing is hidden, only the exhaustive
namewall is trimmed. Disambiguation (`tickersAppearingMoreThanOnce` / `formatOverlapPosition`) still runs
over the FULL list before truncation, so any name that IS shown is still correctly disambiguated even if
its duplicate counterpart falls past the cap.

### Fix rationale

Capping at the rendering layer (not filtering `checkPortfolioOverlap`'s output, which the swing GATE also
consumes per `portfolio.ts`'s own header) keeps this a display-only change — the gate's overlap-count
evidence and every other consumer of `PortfolioOverlap` are untouched.

### Tests

`src/lib/swing/play-brief-intel.test.ts`: new test builds a 10-position same-theme (`crypto-equity`) book,
asserts the lead sentence still reports the true count (10), exactly 8 ticker names are rendered, and the
remainder folds into `+ 2 more`. RED→GREEN verified via `git stash` (fails `10 !== 8` pre-fix, passes
post-fix). Full local `npm test` + `tsc --noEmit` green.

### Market-open validation

See `docs/audit/MARKET-OPEN-VALIDATION.md` — check a live committed swing position in a large same-theme
book (crypto-equity is the densest cluster right now) and confirm the "Book context" section reads a
capped, honest name list rather than a raw ticker wall.
