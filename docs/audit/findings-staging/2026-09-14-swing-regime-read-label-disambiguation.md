> **kind:** FINDING

## Ask Largo's "Why this setup" section showed a pinned Archetype next to a freshly re-derived regime label with no framing — read as an internal contradiction — FIXED

| **Status** | FIXED (this commit) |
|---|---|

**Root cause:** `whyThisSetupSection` (`src/lib/swing/play-brief-intel.ts`) renders two lines back
to back: `**Archetype:** ${whyArchetypeLabel}` (from `play.archetype`, PINNED at commit — never
recomputed after entry) and `**Discovery read:** ${play.regime}` (from `play.regime`, which
`attachThesisExplanation`/`serving-lane.ts` deliberately RE-DERIVES fresh on every scan pass, by
design, to keep the regime read "live"). These are two independent classifier reads of the same
underlying dossier taken at different times, and they can legitimately diverge without either being
wrong — but the bare, unqualified "Discovery read:" label gave no signal that the two lines were
reading different points in time, so a document could show two apparently-conflicting
classifications with nothing to explain why.

**Evidence (live reproduction, 2026-09-14, KR):** pulled KR's live play-brief (a real committed
swing position, archetype pinned 2026-09-11). The "Why this setup" / Thesis-health sections read:

> **Archetype:** Breakout continuation
> ...
> **Discovery read:** Event-driven directional · regime 0.67

The board's own pinned `regime` field for other same-shape positions (ACVA/F/INSP) reads
`"BREAKOUT · BANGER"`, confirming KR's fresh classifier run now reads `EVENT_DRIVEN` while its
pinned `archetype` from commit day remains `BREAKOUT` — a real, legitimate divergence over time,
not a data bug. A member reading both lines together, with no framing distinguishing "at commit"
from "today," would reasonably read this as the brief naming two different, conflicting setups for
the same position.

**Blast radius:** single render line — `whyThisSetupSection` is the only place `play.regime` is
rendered under this label (confirmed by repo-wide grep for the literal string). No other section
independently renders this field.

**Fix:** relabeled `**Discovery read:**` to `**Today's regime read:**` — always accurate (the field
genuinely is re-derived fresh on every scan, whether or not it happens to match the pinned
Archetype line above it), so no drift-detection heuristic was needed. The change is purely a label,
not a data or logic change: `play.regime`'s construction, `play.archetype`'s pinning, and every
other line in the section are untouched.

**Fix rationale:** a plain, always-true label rename was preferred over adding conditional logic to
detect and flag disagreement (e.g., only qualifying the label when archetype/regime differ) — that
would require a reliable string/enum comparison between a pinned archetype code and a free-text
regime blend, which risks its own false-positive/false-negative drift, for a label that is equally
true to state plainly regardless of whether the two values happen to agree.

**Test:** RED→GREEN proven (git-stashed the source fix, confirmed the existing test asserting the
old label and the new KR-shaped regression test both fail without it — the failure output itself
reproduced the exact live KR pattern, "Breakout continuation" next to "Event-driven directional"
under the old unqualified label — restored and confirmed green). Updated 1 existing test's
assertion, added 1 new test mirroring the live KR repro. Full `src/lib/swing/*.test.ts` (1123
tests) green, `tsc --noEmit` and `eslint` clean.
