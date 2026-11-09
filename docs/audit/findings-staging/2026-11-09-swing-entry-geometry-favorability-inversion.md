## Largo swing Entry geometry pillar scored an already-committed position's post-entry favorability using the pre-entry WATCH-stage ordering, inverting "best" and "worst" — FIXED
> **kind:** `FINDING`

### Symptom

Live repro, `SWING:MRVL` positionId 70 (2026-11-09): SHORT, `entryTriggerUnderlyingPx` 179.99,
`liveSpot` 137.70 — price fell ~23.5% in the short's own favorable direction, `livePnlPct` +221.3%,
the best-performing leg in the book. The Ask Largo play-brief's thesis-health "Entry geometry"
pillar nonetheless scored this position 0.35/1.0 (the single worst bucket) and labeled it "chase
risk" — the framing a trader would expect for a position about to be entered too late, not one
already up +221%.

Sibling live repro, `SWING:PLTR` positionId 74: SHORT, `entryTriggerUnderlyingPx` 155.49,
`invalidationUnderlyingPx` 163.02, `liveSpot` 159.76 — price reversed back toward invalidation,
already `TAKE_PARTIAL` (partially trimmed), a genuinely adverse position. This one scored 0.6/1.0
(mid-decent, not the worst bucket) and was labeled "pre-trigger" — implying the position hadn't
even entered yet, when it was already committed and already being managed defensively.

### Root cause

`src/lib/swing/entry-model.ts`'s `deriveEntryState` produces `SwingEntryState`
(`PRE_TRIGGER`/`PULLBACK_TO_ENTRY`/`AT_TRIGGER`/`EXTENDED_CHASE`) as a **pre-entry, WATCH-stage**
taxonomy: it answers "has this ticker reached a good entry yet, or has price already run away
(chase risk) before I could get in?" Its four buckets are geometric and direction-mirrored —
`EXTENDED_CHASE` means price moved substantially PAST the trigger in the trade's own direction;
`PRE_TRIGGER` means price has NOT reached the trigger (on the wrong side of it). Pre-entry, "far
past the trigger" is bad (chasing an extended move) and "hasn't reached it" is neutral (still
waiting).

`entryGeometryScore` in `src/lib/swing/thesis-health.ts` is called ONLY from
`computeSwingThesisHealth`, which itself early-returns `null` unless `status` is
`OPEN`/`HOLD`/`TRIM` — i.e. this function is NEVER invoked for a pre-entry/WATCH candidate, only
for an already-committed position (`adapters.ts`'s `liveEntryStatus`, wired by #5336 to stop this
pillar defaulting to "n/a"). Once a position is already open, the VALENCE of each geometric bucket
flips, because the question flips with it: "has price moved favorably or adversely since I
entered?" `entryGeometryScore` kept the pre-entry score ordering unchanged after #5336 wired live
derivation, producing exactly the inversion above.

### Fix

Re-mapped the same four geometric buckets in `entryGeometryScore` to the correct post-entry
valence — no change to `SwingEntryState`, `deriveEntryState`, or `entry-model.ts` itself (the
pre-entry WATCH-stage taxonomy and its own tests/labels/gate wiring are untouched):

| Bucket | Old score/label | New score/label |
|---|---|---|
| `EXTENDED_CHASE` (favorable continuation past entry) | 0.35 "chase risk" | 0.95 "running favorably" |
| `AT_TRIGGER` (price ≈ entry, neutral) | 1.0 "at trigger" | 0.75 "at trigger" |
| `PULLBACK_TO_ENTRY` (mild giveback) | 0.85 "pullback" | 0.55 "mild giveback" |
| `PRE_TRIGGER` (reversed back through entry, adverse) | 0.6 "pre-trigger" | 0.3 "back through entry" |

`AT_TRIGGER`'s label is kept as "at trigger" (existing regression coverage in `adapters.test.ts`
already depends on it) — it doesn't itself imply favorable or adverse, so leaving it unchanged is
safe. `commit === current` is kept, matching every other non-theta pillar in this file.

### Why this is safe where a naive quick-patch would not be

A prior 2026-09-10 FINDINGS.md entry ("Ask Largo 'Thesis health' pillar breakdown is withheld...")
warned against two unsafe options for this exact tension: (A) fabricating a pre-entry
`setupState`/`entryStatus` for a committed row that never had one, or (B2) reusing
`attachThesisExplanation`'s same-day-dossier re-attachment trick. This fix does neither — #5336
already made live-derivation (real price vs. the position's own real trigger) the shipped
mechanism feeding this pillar; nothing here changes WHAT data produces the bucket. It only
corrects the SCORE/LABEL mapping applied to a bucket this function's one caller already only ever
sees post-entry — the smaller, reviewable "(b) redefine pillar semantics for an ALREADY-COMMITTED
position" option that finding's own Recommendation section named, scoped here to `entry_geometry`
only (`persistence`/`setupPersistenceScore` untouched).

### Evidence

New regression tests in `src/lib/swing/thesis-health.test.ts` (direct, via the one real production
call site `computeSwingThesisHealth` — `entryGeometryScore` is file-private) and
`src/features/nighthawk/command-deck/adapters.test.ts` (the exact live MRVL/PLTR repro shapes end
to end through `terminalPlayFromHorizon`): `EXTENDED_CHASE` now scores strictly above both
`AT_TRIGGER` and `PRE_TRIGGER`; `PRE_TRIGGER` now scores strictly below both; the full ordering
`EXTENDED_CHASE > AT_TRIGGER > PULLBACK_TO_ENTRY > PRE_TRIGGER` is monotonic; neither live repro
renders the old "chase risk"/"pre-trigger" labels anymore. A regression guard confirms
`entry-model.ts`'s WATCH-stage semantics are untouched (this pillar's mapping is local to
`thesis-health.ts`).

`npx tsx --experimental-test-module-mocks --test src/lib/swing/thesis-health.test.ts
src/features/nighthawk/command-deck/adapters.test.ts` — 206/206 pass. `npx tsc --noEmit` clean.
Full `npm test` on Node 20: 18776/18779 pass, 0 fail, 3 skipped (unrelated).

### Blast radius

`entryGeometryScore` has exactly one caller (`computeSwingThesisHealth`, repo-wide grep confirmed).
The "Entry geometry" pillar's weight in the aggregate thesis-health score (22%) and its
`contributionPts`/`deltaPts` derivation are unchanged — only the per-bucket score/label values
feeding into them.

| **Status** | FIXED — this PR |
