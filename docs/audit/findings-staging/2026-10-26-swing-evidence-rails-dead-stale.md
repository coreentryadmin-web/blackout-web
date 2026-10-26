> **kind:** FINDING

## evidenceFromContext's "Exit-policy rails" evidence[] fact goes dead-stale once a trim fires or the target is reached — FIXED

| **Status** | Fixed |
|---|---|

**Where:** `src/lib/swing/play-brief.ts`, `evidenceFromContext()` (~line 1893-1912, the
`statusBucket(ctx.play) === "open"` block's `Exit-policy rails: ...` fact).

**Root cause:** `evidenceFromContext` — the sole feeder of `envelope.evidence[]`, which the API
route surfaces at top level as `evidence_numbers` (the Largo contract's C7 "specific numbers"
field) — built the "Exit-policy rails: stop $X · target $Y" fact directly off the raw
`ctx.play.exitPolicy.stop_premium`/`target_premium` numbers, with no check for whether the position
has already scaled out of the stop or already reached the target.

Both prose renderers in the same response already guard this exact state, and this evidence fact
was the one place that never got the equivalent fix:
- `managementSection` (same file, the "Rails: ..." line, ~line 272-321) computes
  `scaledAlready = hasScaledOut(ep)` and annotates the stop as `"$X _(no longer applies — already
  scaled; runner trail now $Y)_"` once a trim has fired (fixed 2026-10-21, live repro MRNA), and
  separately computes `targetAlreadyFired` and annotates the target as `"$Y ✓ (reached)"` once a
  fired trim's own banked premium is at/above the target level (fixed 2026-10-08, live repro
  EXTR).
- `play-brief-intel.ts`'s `watchForSection` ("Premium stop rail"/"Premium target rail" bullets,
  ~line 2197-2355) independently derives and applies the identical two guards.

Why this matters mechanically, not just cosmetically: once a trim tranche fires, the live exit
engine (`deriveScaleOutAction`/`computeScaleOutTriggerInfo`, `scale-out.ts`) permanently disables
the pre-scale hard stop — it returns `hard_stop_price: null`, "the hard stop no longer applies" —
and the real governing floor becomes the runner's trailing stop off its peak
(`runnerTrailingStopPremium`, `terminal-ladder.ts`). A bare "stop $X" after that point cites a
trigger that structurally cannot fire anymore as if it were still live. Symmetrically, once a fired
trim's premium is at/above `target_premium` (swing's single-rung `SWING_SCALE_OUT_POLICY` prices
`target_pct` identically to its one trim rung's `trigger_pct`, so this is the common case, not an
edge case), "target $Y" reads as a fresh, unmet objective for a level the position already reached
and pulled back from.

Both `hasScaledOut` and `runnerTrailingStopPremium` were already imported in `play-brief.ts` (line
53, from `@/lib/zerodte/terminal-ladder`) for `managementSection`'s own use — the evidence feeder,
added in the same file later (2026-10-25, per its own "BUG FIX" comment, which only addressed the
feeder never mirroring entry/rails into `evidence[]` at all before — it did not address the
scale-out/target-reached override), simply never adopted them.

**Evidence:** confirmed directly in source (not inference) by reading `evidenceFromContext`
(play-brief.ts:1893-1912 as of `main`) against `managementSection` (play-brief.ts:272-321) and
`watchForSection` (play-brief-intel.ts:2197-2355) side by side — the latter two both branch on
`hasScaledOut(ep)`/a fired-trim-at-or-above-target test before rendering the stop/target dollar
figures; the evidence feeder did neither. The existing regression test
(`play-brief.test.ts`, "entry price and exit-policy stop/target rails surface as citable evidence[]
entries for an OPEN position") only fixtured a not-yet-fired trim rung
(`trim_levels: [{ trigger_pct: 100, fraction: 0.5, premium: 1.1, fired: false }]`), so the
already-fired/scaled-out case was untested — confirmed via `git diff`-free revert-and-rerun: with
`play-brief.ts` reverted to the unfixed `origin/main` version and only the new test added, the new
test fails with
`actual: 'Exit-policy rails: stop $0.22 · target $1.10.'` vs
`expected: 'Exit-policy rails: stop $0.22 (no longer applies — already scaled; runner trail now
$0.63) · target $1.10 (already reached).'` — i.e. the bare, un-annotated text the live-production
audit flagged, reproduced exactly from source rather than merely asserted.

**Blast radius:** one function, one evidence fact (`Exit-policy rails: ...`) — grepped the repo;
`evidenceFromContext` is the only producer of this fact in `envelope.evidence[]`, and no other
consumer independently re-derives `stop_premium`/`target_premium` into a citable fact. The prose
sections (`managementSection`, `watchForSection`) already had the correct guard and are untouched.

**Fix rationale:** mirror `managementSection`'s exact gating/wording (same `hasScaledOut`/
`runnerTrailingStopPremium` helpers, same fired-trim-at-or-above-target test) rather than inventing
new phrasing, so the evidence fact and the prose line describing the identical rail state can't
independently drift into disagreement over the same fact a second time — the same discipline this
file's own 2026-10-21/2026-10-08 fixes already established for the prose side. Deliberately left
unchanged: the gate that only emits this fact for `statusBucket === "open"` (WATCH/CLOSED still
correctly carry no rails fact), and the never-fabricate-when-absent discipline (`railParts` is still
only populated per-field when that field is genuinely present).

**Test:** `play-brief.test.ts` — one new regression test,
`composeSwingPlayBrief: Exit-policy rails evidence[] reflects already-scaled stop and
already-reached target`: an OPEN play with `peak: 130` and a fired trim rung priced at the same
level as `target_premium`, asserting the evidence text carries both the "no longer applies —
already scaled; runner trail now $X" stop annotation and the "already reached" target annotation.
Verified RED→GREEN: with `src/lib/swing/play-brief.ts` reverted to the unfixed `origin/main` content
(test file left with the fix applied), the new test fails exactly as described above; with the fix
restored, full `play-brief.test.ts` is 185/185 pass. `tsc --noEmit`: clean.
