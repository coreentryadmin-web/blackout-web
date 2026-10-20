## bookContextSection flattened a literal same-ticker opposed position into the same generic "same theme" framing as a genuinely different name — FIXED

> **kind:** `FINDING`

| **Status** | Fixed |
|---|---|

**Found:** 2026-10-20, Ask Largo standing mandate live deep-dive (5-engine live-check workflow),
TSLA WATCH brief (385P SHORT candidate). Book context read: `**Internal conflict** — theme
"ev-auto" already has an OPPOSED position: TSLA LONG (separate position #60), TSLL LONG. One leg
is structurally betting against the other; this is not a hedge unless intentional.` This flattens
two very different situations into identical prose: TSLL is a different name in the same sector (a
judgment-call diversification/theme bet), while the TSLA LONG is the literal **same underlying**
the candidate is being evaluated against, in the opposite direction — holding TSLA LONG and TSLA
SHORT simultaneously is mechanically self-defeating regardless of thesis, a categorically stronger
signal than a cross-name sector divergence.

**Root cause:** `describeThemeOverlap` (`theme-cluster.ts`) only sharpens its framing to "the same
name" when the candidate's resolved THEME ITSELF is an own-cluster sentinel (`isOwnClusterTheme`)
— i.e. the candidate ticker has no real sector theme at all, so the only way two rows can share
that sentinel is being the same ticker (per `resolveTheme`'s own derivation). TSLA resolves to a
real, multi-name theme (`"ev-auto"`, `src/lib/portfolio/sector-map.ts`), so a same-ticker opposed
row sitting inside that real theme never gets the sharper framing — it reads exactly like the
cross-name (TSLL) case. `formatOverlapPosition` already annotates the same-ticker row with
`(separate position #N)`, but that is one parenthetical among potentially several names inside a
generic theme sentence — easy to read past, and the lead clause ("theme X has an OPPOSED position")
is identical either way.

**Fix:** In `bookContextSection`'s opposed-direction branch, split `overlap.sameThemeOpposedDirection`
into rows that are literally the candidate's own ticker vs. rows that are a different name in the
same theme. Same-ticker rows get a new, distinct "Internal conflict — same underlying" sentence
naming the mechanical self-conflict explicitly; different-ticker rows keep the existing generic
theme sentence unchanged.

**Fix rationale:** Additive, not a rewrite — the existing per-name annotation
(`formatOverlapPosition`) and the generic theme sentence are both kept exactly as they were for the
(common) all-different-ticker case; only a same-ticker row gets a second, sharper sentence. No
change to `theme-cluster.ts`/`portfolio.ts` — `checkPortfolioOverlap` already returns each opposed
row with its own `ticker` field, so the split is a pure filter at the render call site.

**Blast radius:** Single function (`bookContextSection`). Existing tests covering the
different-ticker case (AMD/NVDA, SQQQ/NVDA) are unaffected — confirmed by the full suite staying
green.

**Tests:** 2 new regression tests in `play-brief-intel.test.ts` — (1) a book holding both a
same-ticker opposed position AND a different-ticker same-theme opposed position renders both the
new "same underlying" sentence (for the same-ticker row) and the unchanged generic theme sentence
(for the different-ticker row); (2) a same-theme-but-different-ticker-only book keeps the generic
sentence with no "same underlying" framing. RED→GREEN proven via `git stash` on just the source
file (test (1) failed pre-fix with the generic sentence instead; both pass post-fix). Full
`play-brief-intel.test.ts` (288 tests) green on Node 20. `tsc --noEmit` clean.
