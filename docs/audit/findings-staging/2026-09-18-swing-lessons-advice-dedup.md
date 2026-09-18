# Ask Largo swing brief's "Lessons" section restated the same trim-rail/stop-loss advice the "Trade manager read" section already gave

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | Ask Largo swing play-brief — `lessonsSection` (`src/lib/swing/play-brief-intel.ts`) |
| **Severity** | P3 (member-facing narrative quality — a real restatement-class bug, same shape as three prior fixes in this file) |
| **Status** | FIXED — `fix/swing-lessons-advice-dedup` |

## Root cause

On CLOSED positions, `lessonsSection` (feeds the "Lessons" section) and `closedCoaching`
(`play-brief-narrative-coaching.ts`, feeds "Trade manager read" — rendered immediately above
"Lessons" in the same response) both independently derive the same round-trip/stop-loss facts from
the same `peak`/`exitPnlPct`/`closedReason` inputs. A prior fix (`roundTripAlreadyNoted`, dated
2026-09-06/10/13 per this file's own comments) deduped the round-trip FACT sentence when both
sections would otherwise state it — but the ADVICE clause attached to that fact ("tighten at first
trim rail next time") and the sibling stop-loss advice ("check if entry was extended past
invalidation") were never covered by that dedup, so they survived under the exact mechanism meant
to prevent this class of bug.

## Evidence

Live repro, NN position #32, real production play-brief (CLOSED, STOPPED, peak +24.4%, exit
−60.3%):
- "Trade manager read" (`closedCoaching`): "...tighten at first trim rail next time." + "...check
  if entry was extended past invalidation."
- "Lessons" (`lessonsSection`, same response, immediately below): "**Gave back the move** — next
  time tighten at first trim rail or thesis fade." + "Stop loss — check if invalidation level was
  respected or entry was extended."

Both advice pairs are near-verbatim restatements a member reads one section apart in the same
brief. Confirmed the source strings are real: `play-brief-narrative-coaching.ts` lines 1039/1053
carry "tighten at first trim rail next time."/"check if entry was extended past invalidation."
verbatim.

## Blast radius

Single call site (`buildIntelSections`'s `bucket === "closed"` branch, where `lessonsSection` is
invoked). Every CLOSED swing play-brief whose "Trade manager read" independently stated the
trim-rail or stop-loss advice was affected (round-trip and stopped-exit cases specifically).

## Fix rationale

Extended `lessonsSection`'s existing dedup pattern (same technique as `roundTripAlreadyNoted`) with
two new optional flags, `adviceAlreadyNoted` and `stopAdviceAlreadyNoted`, computed at the
`buildIntelSections` call site by checking whether `narrative.body` already contains the matching
advice text. Suppresses only the two duplicated advice sentences — every independent lesson (MFE
capture number, "strong exit discipline"/"partial capture" verdicts, archetype tag, exec-vs-mid
slippage) is untouched, verified by the new test's explicit assertion that independent evidence
survives suppression.

## Verification

- `npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief-intel.test.ts` —
  143/143 pass. RED→GREEN independently confirmed: reverted only the source fix (kept the new
  test) — 1/143 failed exactly as expected, 142/143 unaffected. Reapplied the fix — 143/143 pass.
- `npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief-intel.test.ts src/lib/swing/play-brief.test.ts src/lib/swing/play-brief-narrative-coaching.test.ts src/lib/swing/play-brief-narrative.test.ts`
  — 411/411 pass.
- `npx tsc --noEmit` — clean.
- Full `npm test` (Node 20) — 14614/14617 pass, 0 fail, 3 pre-existing skips.
