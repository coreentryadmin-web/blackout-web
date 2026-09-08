> **kind:** `FINDING`

## Ask Largo swing brief: same confluence node showed two different scores in the same envelope — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Ask Largo swing play-brief (`play-brief-intel.ts`'s `chartLevelsSection`, `play-brief-narrative-coaching.ts`'s `confluenceCoaching`) |
| **PR** | (pending — `fix/confluence-score-format-mismatch`) |

### Symptom

Found during the standing Ask Largo monitor cycle (2026-09-08), live-fetching the NRG swing brief
(`SWING:NRG`, positionId 34, HOLD/MANAGING). The SAME confluence node — center 129.95,
`gamma-flip+call-wall+max-pain` — was reported with **two different scores in the same response**:
`score 7.5` in the "Trade manager read" narrative section, `score 8` in the "Levels on chart"
structured section. Read as a real cross-product disagreement at first, but both sections read the
identical `vec.confluenceZones` array off the identical `ctx` — there is only one computed score,
not two independently-derived ones.

### Root cause

`ConfluenceZone.score` (`vector-confluence.ts`) is a sum of `DEFAULT_WEIGHTS`, several of which are
half-point values (`gamma-flip: 2.5`, `golden-pocket: 2`, `pdh/pdl/pivot: 1.5`), so a real score
legitimately lands on values like 7.5. `chartLevelsSection`'s `formatConfluenceZone` displayed it
with `z.score.toFixed(0)` (rounds to a whole number — 7.5 → "8"), while `confluenceCoaching`
interpolated `top.score` raw with no formatting at all (shows "7.5" for a 7.5, but would show just
"8" with no decimal for a whole-number score — also inconsistent, just not visibly so on this
sample). Two different display rules for one field, in two sections of one envelope.

### Fix

Both sites now format with `.toFixed(1)` — the natural precision for a half-point-weighted sum,
never lossy (a 7.5 shows as "7.5", a 4.0 shows as "4.0", consistently one decimal everywhere).
`formatConfluenceZone` in `play-brief-intel.ts` and the `confluenceCoaching` template literal in
`play-brief-narrative-coaching.ts` both changed; no scoring logic touched.

### Blast radius

Checked every other `score` reference in the swing brief files for the same class of bug: the
other `score ${z?.score ?? "—"}` sites in `play-brief-narrative-coaching.ts` (lines ~289/290/309)
and `play-brief-narrative.ts` (lines ~413/415) reference a *different* field — 0DTE zone bias score,
not the Vector confluence-zone score — and are out of scope. `vector-confluence.ts`'s own
`confluenceCallouts` formatter (used by the Vector desk UI directly, not imported by any swing
brief file) also prints raw `z.score`; left untouched since it isn't part of this cross-section
inconsistency and is a separate consumer.

### Verify

```
export PATH=/opt/node20/bin:$PATH
npx tsx --test --experimental-test-module-mocks src/lib/swing/play-brief-intel.test.ts src/lib/swing/play-brief-narrative-coaching.test.ts
```

Two new tests: `chartLevelsSection` shows `score 7.5` not `score 8` for a 7.5-scored zone;
`confluenceCoaching` shows the same. RED before the fix — 1/101 failing via `git stash` on the two
source files (only the `chartLevelsSection` side was actually broken; `confluenceCoaching`'s
unrounded interpolation happened to already print "7.5" correctly on this exact value, which is
what made the bug read as "narrative is right, levels is wrong" rather than "both are inconsistent"
— the fix still normalizes both to the same explicit format so neither can drift again). GREEN
after (101/101).

Full `src/lib/swing/*.test.ts`: 828/828 pass. `npx tsc --noEmit`: clean.

### Note

Per `CLAUDE.md`'s self-authored-PR carve-out, this PR holds for Cursor's explicit
`✅ GO AHEAD MERGE` sign-off before merging — not self-merged.
