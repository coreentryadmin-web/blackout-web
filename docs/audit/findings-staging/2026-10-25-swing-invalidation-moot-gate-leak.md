# Swing play-brief `envelope.invalidation` leaked a moot gate's raw reason text for FORMING WATCH candidates

> **kind:** FINDING

| | |
|---|---|
| **Status** | FIXED |
| **Area** | Night Hawk Swings — Ask Largo play-brief (`src/lib/swing/play-brief.ts`) |
| **Severity** | P2 — member-facing Largo UX defect, no financial/data-integrity impact |

## Root cause

`composeSwingPlayBrief`'s `invalidation` fallback chain (play-brief.ts, ~line 2019) is:

```
bucket === "closed" ? null
  : thesisBreak.level === "break" ? thesisBreak.note
    : dead ? "<dead reason> — this setup is no longer live."
      : resolveBreakInvalidation(ctx)
          ?? (sourceFetchFailed ? null : play.gateBlocks?.[0]?.reason)
          ?? (bucket === "open" && stop_premium != null ? "Premium stop at $X" : null)
```

`dead` (`deadPlayReason(play)`) is `bucket === "watch"`-scoped and deliberately does **not** cover
`setupState === "FORMING"` — by its own documented design, a FORMING candidate is still actively
rescanned every cycle, not dead. So a FORMING play with no live resolvable break level
(`resolveBreakInvalidation` returns null — cold GEX/Vector, nothing to compute from) fell straight
through to the raw `play.gateBlocks?.[0]?.reason` — the literal gate-block reason text, unfiltered.

`gateFramingMootReason` (`entry-enterability.ts`, added 2026-10-18) exists precisely to stop a
FORMING/below-floor/`legacy_exempt`-only gate from being presented as if it were a real, clearable
blocker. It is already wired into the Entry section (`watchEntrySection`) and Trade manager read
(`watchGateCoaching`) — but was never wired into this field's own fallback chain, so the top-level
`envelope.invalidation` callout could disagree with its own brief's Entry section about whether a
gate means anything.

**Live repro**: PLTR WATCH brief, 2026-10-24/25 (`GET /api/market/swing/play-brief?playId=
SWING:PLTR&ticker=PLTR&status=WATCH&expandIntel=1`) — `setupState: "FORMING"`, entry window with
3 days still left (not dead), `gateBlocks: [{code:"legacy_exempt", reason:"Legacy morning-confirm
promotion — Swing V2 confluence/Cortex gates were not evaluated on this path."}]`.

- `envelope.invalidation` read: `"Legacy morning-confirm promotion — Swing V2 confluence/Cortex
  gates were not evaluated on this path."` — a provenance marker about *why gates weren't run*,
  not a price level or condition that invalidates anything.
- The SAME brief's own Entry section correctly read: `"**Also gate-blocked** (moot — thesis still
  forming — not yet at trigger) — see Trade manager read below."`

A member reading only the "Invalidation:" callout at the bottom of the markdown would have no
idea what price level or condition actually invalidates the PLTR setup — the field just repeats
unrelated gate-provenance boilerplate.

Because `gateFramingMootReason` fires on `setupState === "FORMING"` alone (independent of gate
code), this also wrongly surfaced a **genuinely-real** gate's raw reason text (not just
`legacy_exempt`) as "the" invalidation whenever a play simply hadn't triggered yet yet — a second,
regression test below proves this with a `g_s4_regime` gate reason in place of `legacy_exempt`.

## Blast radius

Single call site — `envelope.invalidation`'s fallback chain in `play-brief.ts`. No other consumer
reads this specific fallback path independently (the Entry section / Trade manager read already
use `gateFramingMootReason` through their own, separate code paths and were unaffected).

## Fix

Added `gateFramingMoot = bucket === "watch" ? gateFramingMootReason(play) : null` alongside the
existing `dead`/`sourceFetchFailed` locals, and suppressed the raw-gate-reason fallback when it is
truthy — same "omit, don't fabricate" discipline this exact fallback chain already applies for
`sourceFetchFailed` (there is no real per-ticker invalidation level to report when the only gate is
moot, so the honest move is to fall through past it, not invent new text).

```diff
- (sourceFetchFailed ? null : play.gateBlocks?.[0]?.reason) ??
+ (sourceFetchFailed || gateFramingMoot ? null : play.gateBlocks?.[0]?.reason) ??
```

**Fix rationale — why omission, not reframing**: the `dead` case above reframes the EXISTING gate
text (`"<dead reason> — this setup is no longer live."`) because `deadPlayReason` names a real,
specific state. `gateFramingMootReason`'s moot reasons ("thesis still forming", "below the lane
score floor") describe why the gate *doesn't matter yet*, not a fact about invalidation — inventing
a new sentence from them would just be a different fabrication. Falling through to `null` (or the
`open`-bucket premium-stop fallback, unaffected since `gateFramingMoot` is `watch`-scoped) matches
the precedent the `sourceFetchFailed` fix next to it already set.

## Test plan

- New regression test in `play-brief.test.ts`: "top-level Invalidation line omits a moot gate's
  raw reason text for a still-forming WATCH candidate" — direct PLTR-style repro
  (`legacy_exempt`, FORMING), asserts `invalidation === null`.
- Second regression test: same assertion with a genuinely-real gate code (`g_s4_regime`) in place
  of `legacy_exempt`, proving the fix is keyed on moot-*state*, not gate-*code*.
- Fixed a pre-existing test that enshrined the bug as "expected": "top-level Invalidation line
  still uses the real gate reason when entry is genuinely still open" used the base `fixturePlay()`
  defaults (FORMING/PRE_TRIGGER) while its own title claimed "genuinely still open" — the exact
  same fixture/title mismatch already caught and fixed for its Entry-section sibling test on
  2026-10-18, missed here. Overridden to `TRIGGERED`/`AT_TRIGGER`/`aboveFloor:true` so it actually
  tests what its title says.
- RED confirmed via `git stash push -- src/lib/swing/play-brief.ts` (reproduces the live PLTR text
  verbatim), GREEN after restoring.
- Full `play-brief.test.ts`: 171/171 pass. Sibling suites (`entry-enterability.test.ts`,
  `play-brief-intel.test.ts`, `play-brief-narrative-coaching.test.ts`): 545/545 pass combined.
- `tsc --noEmit`: clean.
