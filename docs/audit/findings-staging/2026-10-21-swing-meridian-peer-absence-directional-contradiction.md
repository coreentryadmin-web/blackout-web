## 2026-10-21 — [FINDING, swing] Meridian peer-cohort absence footer claimed peer data wasn't "directional" while the brief's own body rendered real directional beat-rate data two clauses away

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P3 (Largo C3 absence-disclosure self-contradiction — the envelope's own footer denies data its own body just showed) |
| **Surface** | `src/lib/swing/play-brief-absence.ts` — `collectBriefUnavailableSources()`'s Meridian peer cohort `insufficient_reason` branch |

### Root cause

`ctx.meridianPeer` carries two independent facts from the same cohort object: (1) whether enough
peers have a *comparable implied-move number* to rank this ticker's expected move against
(`distribution`/`insufficient_reason`, gated at `MIN_COHORT_PEERS`), and (2) each peer's own
print-history beat rate (`members[].beat_rate`/`beat_rate_n`), gated independently at
`beat_rate_n >= 3` per peer — a documented "DIFFERENT cohorts" distinction already called out in
`meridian-peer-cohort-for-largo-core.ts`'s own comments. These can diverge: the implied-move ranking
cohort can be thin while the beat-rate cohort still qualifies.

`collectBriefUnavailableSources()`'s `insufficient_reason` branch fired purely off the ranking-cohort
condition and attached a generic, static `what_is_missing: "enough peer names in the cohort to be
directional"` — with no check of whether `ctx.meridianPeer.members` actually contained qualifying
beat-rate peers. When it did, the footer's "not enough... to be directional" claim directly
contradicted the brief's own in-body "Earnings peer lens" section (`meridianPeerEarningsCoaching`,
`play-brief-meridian-peer-core.ts`), which renders those same peers' beat rates and explicitly calls
them "directional only" — the opposite framing, two clauses away in the same document.

### Evidence

Live repro (closed TSLA play-brief, broader multi-ticker Ask Largo audit, 2026-10-21):

```
## Earnings peer lens
... peer history: **WGO** 75% beat (n=4) · **WAB** 100% beat (n=4) ·
_Implied-move cohort thin: no peers reporting with a comparable number — too few to rank against_.
```

```
_Unavailable this turn:_ Meridian peer cohort (no peers reporting with a comparable number — too
few to rank against)
```

The footer reuses the exact "too few to rank" phrase the body scoped only to the implied-move
sub-metric, but applies it to "Meridian peer cohort" broadly — which plainly produced usable,
rendered beat-rate data (WGO/WAB) in the same document. Contrast: the sibling GOOGL-closed document
in the same sweep has zero peer data and correctly has nothing to contradict its own unavailable
claim — confirming TSLA's case is a real anomaly, not standard behavior.

Added two tests to `play-brief-absence.test.ts` (one RED repro matching the live TSLA shape, one
control confirming the original wording is preserved when no qualifying beat-rate peers exist).
RED→GREEN, git-stash-verified on the source file alone: 96/97 (1 fail) before the fix, 97/97 after.
Broader regression sweep: all `src/lib/swing/play-brief*.test.ts` — 1121/1121 pass. `tsc --noEmit`
clean.

### Blast radius

Single branch in a single function. Confirmed no other call site string-matches on the
`"Meridian peer cohort"` source label (the only other occurrence of that literal string is an
unrelated `note` field in `play-brief-meridian-peer.ts`).

### Fix

When `ctx.meridianPeer.members` contains at least one non-subject peer with `beat_rate_n >= 3` (the
same floor `meridianPeerEarningsCoaching` uses to render them), the absence entry now: (1) renames
the source to `"Meridian implied-move ranking"` — precise about which sub-metric is actually thin,
matching the body's own "Implied-move cohort thin" phrasing — and (2) rewords `what_is_missing` to
scope the gap to the ranking specifically and note that beat-rate peer history is still shown
separately, dropping the word "directional" so it can no longer contradict the body's own framing.
When no qualifying beat-rate peers exist, the original wording and `"Meridian peer cohort"` label
are preserved unchanged (control test).

### Why not a bigger fix

Did not touch `meridianPeerEarningsCoaching`'s own rendering logic (already correct — it already
scopes "Implied-move cohort thin" to the right sub-metric and already states peer beat rates are
"directional only") or the cohort-shaping logic in `meridian-peer-cohort-for-largo-core.ts` (the
two-cohort design itself is intentional and documented). The defect was isolated to this one
absence-entry's wording not accounting for the cohort split already correctly handled everywhere
else.
