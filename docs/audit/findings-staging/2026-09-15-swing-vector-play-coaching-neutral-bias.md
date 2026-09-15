> **kind:** FINDING

## `vectorPlayCoaching` conflated "Vector has no opinion" with "Vector disagrees" — FIXED

| **Status** | FIXED (this commit) |
|---|---|

**Root cause:** `vectorPlayCoaching` (`src/lib/swing/play-brief-narrative-coaching.ts`) computed
`aligned` by checking whether `vp.bias` matched the play's own direction (`"long"`/`"short"`), then
appended a `"— **cross-check** Vector thesis vs swing direction."` suffix whenever `!aligned`. But
`vp.bias` is typed as a bare `string` at the consumer boundary (`full-platform-snapshot.ts:41`,
`dynamic-format.ts:24`) and is actually a real four-value enum at the source
(`VectorPlayBias = "long" | "short" | "range" | "neutral"`, `vector-play-engine.ts:111`). The old
`aligned` check only recognized the two directional values as a match — any other value, including
an explicit `"range"`/`"neutral"` read (Vector genuinely declining to take a directional position),
fell into the exact same `!aligned` branch as a real directional conflict.

**Evidence (live reproduction, 2026-09-15, TDOC and ASAN, both real swing-discovery briefs):**
Vector's own headline read `"POSITION · stand aside — no clean edge"` — an explicit "I have no
directional opinion here" statement — yet the brief still appended `"— cross-check Vector thesis vs
swing direction"` immediately after it. A trader reading "stand aside" followed by "cross-check ...
direction" reasonably infers Vector disagrees with the swing thesis, when Vector explicitly declined
to take a position at all.

**Blast radius:** any swing brief where Vector's play engine resolves a `"range"` or `"neutral"`
bias for the ticker — the `vectorPlayCoaching` bullet, the one section most directly framed around
"does Vector's own desk agree or disagree with this trade."

**Fix:** added `biasIsDirectional = vp.bias === "long" || vp.bias === "short"` and gated the
conflict-phrased suffix on it (`!aligned && biasIsDirectional && ...`). A non-directional bias now
gets neither the "aligned" framing (not true — Vector took no position) nor the "cross-check"
framing (also not true — there's no directional claim to conflict with); it renders the raw
headline/invalidation facts with no added framing clause, honestly reflecting that Vector expressed
no opinion.

**Fix rationale:** minimal, targeted change to the existing boolean logic — no restructuring of the
function's control flow, no change to the `aligned`-true branch (still fires exactly as before for
genuine directional matches), no change to any other coaching function. Chose an explicit
`biasIsDirectional` guard over widening the `aligned` check itself, since "aligned" and "not
directional" are two different facts that deserve two different (in this case, both silent)
outcomes, not one collapsed boolean.

**Test:** RED→GREEN proven (git-stashed the source fix, confirmed both new regression tests — one
for `"neutral"` bias, one for `"range"` bias, both built off the live TDOC/ASAN repro shape — fail
with the exact production symptom (`"cross-check"` appended after a "stand aside" headline) against
pre-fix code; restored and confirmed both pass green, alongside the two pre-existing directional
tests which are unaffected). Full `src/lib/swing/*.test.ts` suite (1146 tests, up from 1144) green,
`tsc --noEmit` and `eslint` clean on both changed files.
