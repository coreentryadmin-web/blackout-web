# Ask Largo swing brief's cross-desk friction coaching silently drops a 4th disagreeing desk with no trace or count

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | Ask Largo swing play-brief — `crossDeskCoaching`/`renderCrossDeskConflict` (`src/lib/swing/play-brief-narrative-coaching.ts`), the "Cross-desk friction" narrative line |
| **Severity** | P3 — member-facing narrative completeness (Largo product contract "absence" principle), not a live-trading-path change |
| **Status** | FIXED — `fix/cross-desk-4th-conflict-silent-drop` |
| **Found by** | ASK LARGO × NIGHT HAWK SWINGS standing ownership mandate, 5-engine live monitor cycle, 2026-09-19 (Saturday, market closed) |

### Root cause

`crossDeskCoaching` checks up to FOUR independent desks against the swing's own direction — Night
Hawk (digest), 0DTE (intraday_scalp), Vector (structure), and HELIX flow — and pushes a `conflict`
entry for each one that disagrees. `renderCrossDeskConflict` then ranks all conflicts by
load-bearing weight, names the lead (highest-weight) conflict in full, and appends up to
`rest.slice(0, 2)` more — i.e. at most 3 conflicting desks are EVER named in the rendered text,
regardless of how many actually disagree.

Since exactly 4 desks are ever checked, the only way to exceed "lead + 2" is all 4 disagreeing at
once (1 lead + 3 in `rest`). Before this fix, that case silently dropped the 4th (lowest-weight)
conflicting desk from the rendered text entirely — no name, no count, no "+1 more" disclosure, just
gone. A member reading the brief in that state would see three desks disagreeing and have no way to
know a fourth genuinely did too.

This is exactly the failure mode `docs/audit/LARGO-PRODUCT-CONTRACT.md`'s disagreement principle
exists to prevent: *"Cross-product disagreement is represented, never reconciled by the lanes
themselves... A lane that quietly adjusts its numbers to match a peer has destroyed the signal and
left a false consensus."* Dropping the 4th conflict without disclosure isn't reconciliation in the
technical sense, but the member-facing effect is identical — the disagreement silently vanishes
from what they're told, producing a false read of how much of the desk actually disagrees (3-desk
friction reads very differently from 4-desk unanimous-against friction).

The 2- and 3-conflict cases were already covered by existing tests and both render correctly (3
fits inside lead + `rest.slice(0,2)` exactly, with nothing dropped). Nothing exercised the genuine
maximum — 4 simultaneous conflicts — until this cycle's edge-case sweep of the function per the
standing mandate ("does `crossDeskCoaching` handle 3+ desks disagreeing without degrading to
generic prose").

### Evidence

New regression test `crossDeskCoaching: FOUR conflicting desks at once must not silently drop the
4th disagreement` (`src/lib/swing/play-brief-narrative-coaching.test.ts`) builds a fixture where
Night Hawk (short), 0DTE (short), Vector (short), and HELIX flow (put-led) all disagree with a LONG
swing simultaneously. Pre-fix (RED, confirmed via `git stash`):

```
**Cross-desk friction** — Vector bearish (Fade the rip). That's live price structure — the same
tape this swing itself trades — exactly the evidence a **Breakout continuation** setup leans on, so
weight it heaviest: watch for it to flip back before your next trim rail — until then, size down.
HELIX also reads put-led (same-session options order flow, not price structure) — lighter weight
here; Night Hawk also reads bearish (B) (last night's overnight next-day digest, not a live read) —
lighter weight here.
```

0DTE's "short (score 78)" conflict — genuinely detected (it's in the `conflicts` array, ranked
last by weight) — never appears anywhere in the output. Post-fix (GREEN): the same rendering now
appends `(+1 more desk also disagree — not detailed here.)` after the two named "rest" desks, so
the existence of the 4th disagreement is disclosed even though the lead+2 cap keeps the sentence
from listing all four verbosely.

### Fix rationale

Added an omission-count disclosure clause to `renderCrossDeskConflict`, gated on `rest.length -
shown.length > 0` (only ever fires on the true 4-conflict case given the fixed 4-desk universe this
function checks). Deliberately did NOT change the lead+2 cap itself — the existing design rationale
("the coaching ends on one concrete next-check instead of N") is sound for readability, and listing
all 4 desks' full reasoning would re-introduce the flat, unweighted dump the original
`renderCrossDeskConflict` rewrite (referenced in this file's own comments, #4104/#4110/#4116-era)
was built to replace. Disclosing the omitted count is the minimal fix that keeps both properties:
concise reasoning on the top 3, and honest acknowledgment that a 4th disagreement exists rather than
erasing it.

### Blast radius

Single call site (`renderCrossDeskConflict` is only invoked from `crossDeskCoaching` in this file).
No other narrative section reuses this rendering function. `collectCoachingBullets`'s consumption of
`crossDeskCoaching`'s output is unaffected — it still receives one string, just with the extra
clause appended when the 4-conflict case fires.
