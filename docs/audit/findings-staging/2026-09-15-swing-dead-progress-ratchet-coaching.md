> **kind:** FINDING

## `progressRatchetCoaching` was called unconditionally in every swing coaching pass but was structurally guaranteed to always return null — FIXED (dead-code removal)

| **Status** | FIXED (this commit) |
|---|---|

**Root cause:** `progressRatchetCoaching(play)` (`src/lib/swing/play-brief-narrative-coaching.ts`)
gated on `play.progress != null && play.exitModel === "RATCHET"`. `play.progress` is genuinely live
for swing (`terminalPlayFromHorizon`, `adapters.ts`, sets `progress: mgmt.progress` — the same value
already rendered honestly as "Trim progress: X%" in `play-brief.ts`'s Position section), but
`play.exitModel` is **hardcoded to the literal string `"SCALE_OUT"`** for every swing/LEAPS row —
confirmed by grepping the function's real body (verified boundary: 801-1027, ending immediately
before the `EditionDeckSource` interface at line 1032) for both `exitModel` assignments; only
`"SCALE_OUT"` ever appears, no `"RATCHET"` branch exists anywhere in the SWING/LEAPS adapter. No
swing-side resolve step (`play-brief-resolve.ts`) overrides it either. `"RATCHET"` is a real,
legitimately-used value elsewhere (`ExitModel` type, `terminal-guards.ts`) — just never for this
lane. Called unconditionally in the swing coaching assembly, so `play.exitModel !== "RATCHET"` was
always true for every swing row, making this function structurally guaranteed to always return
`null` — same dead-gate shape as `scorecardCoaching` and `morningConfirmCoaching`, both removed
earlier the same day/week for the identical reason.

**Evidence:** grepped `terminalPlayFromHorizon`'s true function body for `exitModel`: two matches,
both the literal `"SCALE_OUT"`. Grepped `play-brief-resolve.ts`: zero `exitModel` matches. Grepped
the whole repo for `progressRatchetCoaching`: exactly two matches before this fix, the function
definition and its one call site — plus one unit test that could only reach it by constructing a
synthetic `exitModel: "RATCHET"` fixture real swing data never produces.

**Blast radius:** none on member-facing output — same as the two prior removals, the call always
evaluated to `null` and `push()` silently drops nulls, so this was a functional no-op, not a
rendering defect. `play.progress` itself was never lost — it's already rendered correctly via the
Position section's "Trim progress" line, which has no `RATCHET` dependency.

**Fix:** removed the dead function, its call site, and its now-orphaned regression test (which only
existed to exercise a sign-formatting bug via a synthetic `RATCHET` fixture — the underlying
`fmtOptionUsd` sign-defect class it guarded remains covered by that shared helper's own tests). Also
removed the now-unused `fmtUsd` import and its accompanying stale comment block (both existed only
to serve this function).

**Fix rationale:** deletion over a defensive comment-out, matching the two prior removals in this
same file this session — the underlying architectural fact (swing never uses the RATCHET exit
primitive) is not expected to change, and `play.progress` already has an honest, live rendering path
elsewhere in the brief.

**Test:** the one existing test for this function was removed along with it (it only ever exercised
a synthetic, production-unreachable fixture shape). Full `src/lib/swing/*.test.ts` suite (1143
tests, down 1 from removing the dead test, no other change) green, `tsc --noEmit` and `eslint` clean
on both changed files.
