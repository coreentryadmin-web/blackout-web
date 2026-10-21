## 2026-10-21 — [FINDING, swing] WATCH-bucket brief states setup maturity/serving section three times, two of them in the same section — Ask Largo round-3 deep-dive

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P3 (narrative-quality/consistency — the exact defect class this codebase has repeatedly found and fixed in these two files) |
| **Surface** | `src/lib/swing/play-brief-intel.ts` — `whyThisSetupSection()` |

### Root cause

`whyThisSetupSection()` unconditionally re-rendered `play.servingSection`/`play.setupState` as
"Desk section"/"Setup maturity" at the end of the section — the identical two fields
`watchEntrySection()` (`play-brief.ts`) already renders as "Serving section"/"Setup" in the Entry
section `composeSwingPlayBrief` always places immediately before "Why this setup" for a WATCH play.
Worse, `synthesizedSetupLede()` also folds `play.setupState` into the lede sentence that opens the
very same "Why this setup" section, so a single fact (`setupState`) could be stated three separate
times in one brief — twice in one section.

The "lede subsumes, never duplicates" discipline this exact function already applies to the
Signals/Archetype/Sub-lane flat lines (its own existing test:
`whyThisSetupSection: synthesizes a lede sentence for the common case, replacing (not duplicating)
Signals/Archetype/Sub-lane`) was never extended to the trailing "Setup maturity" line, and no bucket
gating existed to suppress the cross-section duplicate with `watchEntrySection` either.

### Evidence

Live TSLA WATCH envelope: Entry section reads "Serving section: **WATCH**" / "Setup:
**TRIGGERED**". The very next section, "Why this setup", opens with a lede folding in `setupState`
("...flagged this as a triggered event-driven directional setup...") and then closes with "Desk
section: **WATCH**" / "Setup maturity: **TRIGGERED**" — the same two facts restated under different
labels, one restatement inside the same section as the lede that already said it.

Ran `whyThisSetupSection` directly against a scratch fixture to confirm before touching source:
`setupState: "FORMING"`, `servingSection: "WATCH"` produced a lede plus an unconditional trailer
restating both facts.

Added two new tests to `play-brief-intel.test.ts` — RED (306/308, git-stash-verified on the source
file alone) before the fix, GREEN (308/308) after:
- the lede-subsumes case (non-WATCH call, setupState must appear exactly once in the section)
- the WATCH-bucket case (`whyThisSetupSection(play, "watch")` must omit "Desk section"/"Setup
  maturity" entirely)

Broader regression sweep: `play-brief.test.ts` 161/161. `tsc --noEmit` clean.

### Blast radius

`buildIntelSections` calls `whyThisSetupSection(play)` unconditionally (no bucket gating on this
specific call previously) and `collapseRedundantIntelSections` (`play-brief-intel-collapse.ts`)
does not include "Why this setup" in its `NARRATIVE_COVERED_TITLES` dedup set — nothing downstream
removed this duplication before the fix. `git log -S` shows the Entry-section lines (`play-brief.ts`)
and the `whyThisSetupSection` lines (`play-brief-intel.ts`) were both written in the same initial
Sept 2026 PRs with no coordination between the two files.

### Fix

Added an optional `bucket?: "watch" | "open" | "closed"` parameter to `whyThisSetupSection`
(backward-compatible — every existing one-argument test call site is unaffected, since `bucket`
defaults to `undefined` and behaves as "not watch"). Threaded `bucket` through from
`buildIntelSections`'s existing parameter (it already has one, used by sibling sections). Two
guards:
1. Suppress the trailing "Setup maturity" line when `lede` already fired (`play.setupState && !lede`).
2. Omit both "Desk section"/"Setup maturity" entirely when `bucket === "watch"`.

Left in place for open/closed buckets, where no sibling section restates these facts.

### Why not a bigger fix

A narrow, additive change — two guard conditions, one new optional parameter threaded through one
call site in `buildIntelSections` — no rewrite of the section, no change to non-WATCH behavior, no
change to the lede logic itself.
