## Cortex sector-heat evidence — per-ticker change % rendered without a sign, reads as same-signed as the sector

> **kind:** FINDING

### Root cause

`deriveSectorHeatEvidence` (`src/lib/nighthawk/cortex/sources/sector-heat.ts`) builds its
single-name evidence detail as:

```
sector ${sector.sectorName} is ${fmtNum(chg)}% on the day (${ticker} ${fmtNum(sector.tickerChangePct)}%) — the room ${aligned ? "supports" : "opposes"} a ${direction}.
```

`fmtNum` (`sources/shared.ts`) rounds via `toFixed(2)` then calls bare `.toString()` — which
surfaces JS's own leading `-` for a negative number but never adds a `+` for a positive one. Both
`chg` (the sector's own change) and `tickerChangePct` (the ticker's own change) are directional
signed percentages rendered with this same unsigned formatter.

Live-observed today (IONQ, 2026-09-14 ~10:16 ET commit, `entry_context.cortex`): `"sector
Technology is -1.9% on the day (IONQ 2.94%) — the room opposes a long."` The sector is visibly
negative (shows its `-`). IONQ's own change (`+2.94%`, genuinely up on the day per
`sector.tickerChangePct`) renders as bare `2.94` — no sign at all. A reader scanning the sentence
has no visual cue that the ticker is moving in the OPPOSITE direction from its sector; the bare
number next to a visibly-negative one reads as ambiguous at best, same-signed at worst. This is
exactly the idiosyncratic-decoupling case the source's own file header says it exists to surface
("idiosyncratic names ... legitimately decouple") — the one case where showing the ticker's own
sign clearly matters most is the one case the formatting obscured.

The codebase already has the right helper for this: `compose.ts` defines a local, unexported
`fmtSigned(v)` ("+1.85" / "-0.6" / "0") for exactly this need on the narrative header's score line
— it was never shared or reused by `sector-heat.ts`.

### Blast radius

Only `sector-heat.ts`'s single-name branch reads a per-ticker change percent this way — no other
Cortex source (`gex-walls`, `darkpool-confluence`, `vex-charm`, `wall-trend`, `opening-harvest`)
renders a signed directional value through `fmtNum` without accompanying disambiguating words (their
`fmtNum` uses are magnitudes/distances/strikes, or already state direction in words like "gap up/down").
The sector's own `chg` value (3 call sites in the same file) is left as `fmtNum` deliberately — see
Fix rationale.

### Fix rationale

Added `fmtSigned` to `sources/shared.ts` (co-located with `fmtNum`, same `toFixed(2)` rounding —
just always shows the sign) and switched only the `tickerChangePct` render in `sector-heat.ts` to
use it. Left the sector's own `chg` renders (flat-sector message, catalyst-exemption message, main
sentence) as `fmtNum`: each of those three sentences already states the sector's direction in
words ("opposes the direction", "the room supports/opposes a direction"), so `chg`'s own sign isn't
load-bearing the way the bare, wordless `(TICKER N%)` aside is — narrowing the fix to the actual
ambiguity keeps this a single, well-scoped change rather than a blanket reformat.

Did not touch `compose.ts`'s own local `fmtSigned` (a different call site, unrelated to this
finding, out of scope for a single-issue PR) — noted here as the existing precedent for this exact
pattern, in case a future PR wants to consolidate the two into one shared implementation.

### Evidence

`src/lib/nighthawk/cortex/sources/sector-heat.test.ts` — added two regression tests: a ticker
diverging positively from a falling sector now asserts `/TEST \+2\.94%/` (RED before this fix: the
old assertion pattern this test replaces would have matched bare `2.94%` with no sign — confirmed
via `git stash` on the two source files, 1/9 fail pre-fix, 9/9 pass post-fix); a ticker falling with
its sector still shows its own `-` sign (unchanged behavior, guards against the fix over-correcting
to *always* prepend `+`).

`narrative.guard.test.ts` (the Cortex no-fake-numbers guard) — 8/8 pass; the added `+` prefix isn't
swept into the guard's number-extraction regex (`-?\d+(?:\.\d+)?` has no `+` alternation), so the
guard still finds and validates the same numeric value.

Full suite on Node 20: 14152 pass / 0 fail / 3 skipped (pre-existing skips, unrelated).
`npx tsc --noEmit` clean.

| **Status** | FIXED in `fix/sector-heat-signed-ticker-pct` |
