## 2026-10-07 — [FINDING, P3 swing/Ask-Largo] `dataFreshnessSection` never got the 2026-09-19 dead-WATCH staleness-suppression fix, so a dead WATCH play's narrative prose can flatly contradict its own structured `unavailableSources`/`confidence` — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Area** | `src/lib/swing/play-brief-intel.ts` (`dataFreshnessSection`), `src/lib/swing/entry-enterability.ts` (new shared predicate) |
| **Severity** | P3 — a real, member-visible self-contradiction inside a single Ask Largo play-brief envelope, not a data-correctness or gate defect |
| **Found via** | Standing Ask Largo × Night Hawk Swings mandate deep-dive, live `GET /api/market/swing/play-brief?playId=SWING:NTAP&ticker=NTAP` against production |

### Root cause

`play-brief-absence.ts`'s `collectBriefUnavailableSources` — the function that produces the
envelope's structured `unavailableSources[]` chips and feeds `confidence` — was widened on
2026-09-19 to suppress every "is today's live desk state current" staleness check (HELIX flow,
Vector snapshot, GEX positioning, etc.) not just for a CLOSED play but also for a dead-but-not-
closed **WATCH** play: one whose `deadPlayReason` (entry-enterability.ts) is non-null — thesis
invalidated, entry-validity window expired, contract expired, or extended past the valid entry
window (`entryStatus: "EXTENDED_CHASE"`). The reasoning (already documented in that file) is sound:
nothing will ever re-scan a dead candidate, so "HELIX flow is stale" stops being a useful fact and
starts being permanently, uselessly true.

`play-brief-intel.ts`'s `dataFreshnessSection` — the function that renders the human-readable
"Data freshness" narrative section of the SAME envelope — independently re-implemented only the
`isClosed` half of that same gate (its own code comment cites the 2026-09-12 CLOSED-play fix this
mirrors), and was never updated when the 2026-09-19 PR widened its sibling. So for a dead WATCH
play, the structured chip layer correctly stayed silent on HELIX/Vector/GEX staleness, while the
narrative layer kept asserting it — two parts of one envelope disagreeing about the same fact,
exactly the class of defect this file's own comments (and the 2026-10-06 HUT fix to
`evidenceFromContext` in `play-brief.ts`) describe and warn against recurring elsewhere.

### Evidence

Live production repro, 2026-10-07 ~06:43 ET, `GET /api/market/swing/play-brief?playId=SWING:NTAP&ticker=NTAP`:
- `envelope.confidence`: `{"level": "high", "why": "Every live source this brief reads from resolved cleanly this cycle."}`
- `envelope.unavailableSources`: `[]`
- `envelope.sections` "Data freshness" body (same envelope): `"Swing scan: 2026-10-07 06:00 ET\nHELIX flow: **pipeline stale** — tape read may lag; not evidence of quiet flow"`
- NTAP's play carries `entryStatus: "EXTENDED_CHASE"` (confirmed via the live `horizons?view=swings` board) and `status: "COMMIT"` (a WATCH-bucket row, not OPEN/HOLD/TRIM/CLOSED) — exactly the `deadPlayReason` case the 2026-09-19 fix widened `collectBriefUnavailableSources` to cover, but `dataFreshnessSection` never checked.

Regression test added (`src/lib/swing/play-brief-intel.test.ts`): a `fixturePlay({ status: "WATCH",
entryStatus: "EXTENDED_CHASE" })` with `flow_feed_fresh: false` reproduced the bug pre-fix (body
still asserted `HELIX flow: **pipeline stale**`), and passes post-fix (the narrative line is
suppressed, matching the structured chip layer). Verified RED→GREEN via `git stash` of the fix
files.

### Blast radius

Checked every other call site in `play-brief-intel.ts`/`play-brief.ts`/`play-brief-narrative*.ts`
for the same `isClosed`-only pattern (`grep -n "isClosed\b"`): only `dataFreshnessSection` had it.
`play-brief.ts`'s `evidenceFromContext` already got an equivalent (and narrower-scoped, CLOSED-only)
fix on 2026-10-06 for a different field (`scanAsOf`); it was not touched here because its own
comment scopes it specifically to a CLOSED play's "recent scan" citation, a different field from
the Vector/GEX/HELIX staleness lines this fix addresses, and widening it further was out of scope
for a single-issue fix. `collectBriefUnavailableSources` itself was NOT changed — it already had the
correct, wider gate; this fix brings its sibling narrative section into agreement with it via a new
shared predicate rather than re-deriving the logic a third time.

### Fix rationale

Extracted the `isClosed || isDeadWatch` logic that was inlined as a private local in
`collectBriefUnavailableSources` into a new exported predicate,
`isSwingPlayStaleCheckExempt(play)`, in `entry-enterability.ts` (which already owns
`deadPlayReason`, the primitive both gates are built on). `dataFreshnessSection` now calls this
shared predicate instead of re-deriving `isClosed` on its own, so the two call sites cannot drift
apart a third time. Left `collectBriefUnavailableSources`'s own inline logic untouched (did not
refactor it to call the new shared helper) to keep this a minimal, single-issue diff — the new
predicate is additive and correctness-preserving for every existing caller of either function;
migrating the first caller onto it was deferred as a non-functional cleanup, not a fix.

### Verification

- `npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief-intel.test.ts` — 205/205 pass (was 204/205 with the new test alone, before the fix).
- `npx tsx --experimental-test-module-mocks --test src/lib/swing/entry-enterability.test.ts` — 21/21 pass.
- `npx tsc --noEmit` — clean.
- Full `npm test` (Node 20) — run as part of this PR's CI.
