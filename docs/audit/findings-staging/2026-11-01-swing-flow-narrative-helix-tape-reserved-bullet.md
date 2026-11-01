> **kind:** FINDING

## Swing `tradeManagerNarrativeSection`: "HELIX tape" flow bullet silently starved by MAX_BULLETS, undermining the collapse note that claims it was "folded in" — FIXED

| **Status** | Fixed |
|---|---|

**Found by:** live audit of blackout-web, per the standing Ask Largo × Night Hawk Swings ownership
mandate (CLAUDE.md). Same bug class as the `dealerPostureLine` MAX_BULLETS-starvation fix (PR
#7166, `docs/audit/findings-staging/2026-11-01-swing-dealer-posture-reserved-bullet.md`), but a
different call site/section: `flowNarrative`'s "HELIX tape" bullet, not the dealer-posture bullet.

**Live repro shape:** `flowNarrative`'s own doc comment (`src/lib/swing/play-brief-narrative.ts`,
just above its definition) states: "this bullet is the ONLY flow content that survives
`collapseRedundantIntelSections` for OPEN/WATCH buckets." `collapseRedundantIntelSections`
(`src/lib/swing/play-brief-intel-collapse.ts`) deletes the dedicated "Flow & positioning" section
(`NARRATIVE_COVERED_TITLES`) whenever a narrative section exists for a non-closed bucket, and
replaces it with a note: "Desk detail for N section(s) folded into Trade manager read above." That
claim is only true if the HELIX tape bullet actually renders in the narrative. It did not always.

**Root cause:** in `tradeManagerNarrativeSection`, the call that renders `flowNarrative`'s bullet
(near the end of the function, after `action`, `rollHistoryLine`, the entire
`collectCoachingBullets` loop — up to ~20+ candidate bullets for an OPEN/WATCH position, none
cap-aware — the dealer-posture line, and the whole `collectFocalLevels` loop) was never marked
`{ reserved: true }`:

```ts
const flow = flowNarrative(ctx, play);
if (flow && !bullets.some((b) => /HELIX tape/i.test(b))) add(flow);   // <-- not reserved
```

`add()` is gated by `MAX_BULLETS = 14` (`!opts?.reserved && bullets.length >= MAX_BULLETS` drops
the bullet silently, no log, nothing in the response). Because `flowNarrative`'s call site runs
dead last among the non-reserved additions, any realistic combination of earlier content —
coaching bullets, dealer posture, focal levels — can fill all 14 non-reserved slots before this
call is ever reached, dropping the flow bullet entirely while `collapseRedundantIntelSections`
still asserts (falsely) that its content was "folded into Trade manager read above."

**Repro (in-process, using the exact "rich Vector data" MAX_BULLETS-stress fixture already checked
into `src/lib/swing/play-brief-narrative.test.ts`, "Break watch + Counter-thesis survive
MAX_BULLETS on rich Vector data," plus that fixture's own `ecosystem.recent_flow` — already
present, put-heavy/LONG-conflicting, `flow_feed_fresh: true`):** ran
`tradeManagerNarrativeSection` directly. Pre-fix, the section renders **16 bullets**: 14
non-reserved (action/Pillar fade/Manage plan/Catalyst/Cross-desk friction/VEX lens/Gamma
magnet/Confluence/Chart read/dealer posture/4 focal levels) fill the cap, then "Break watch" and
"Counter-thesis" land as reserved #15/#16 — and `/HELIX tape/i.test(section.body)` is **false**.
The bullet is computed (non-null, since `print_count > 0` and `flow_feed_fresh: true`) but
discarded by the cap. In the real app, `collapseRedundantIntelSections(out, { hasNarrative: true,
bucket: "open" })` would simultaneously delete the dedicated "Flow & positioning" section for the
same ticker — so the member sees **no flow/positioning content anywhere in the brief**, alongside
a note actively claiming otherwise.

**Blast radius (named, not fixed here):** the same shape — a non-reserved `add()`/`push()` call
standing in as the sole surviving content for a title `NARRATIVE_COVERED_TITLES` can delete —
applies to other collapsed titles: `laneRankCoaching` ("Lane rank"), `macroTapeCoaching` ("Macro
tape"), `wallDynamicsCoaching` plus the "Wall just moved"/"Nearest wall" lines ("Wall dynamics"),
`vectorPlayCoaching` ("Vector desk"), and the non-invalidation entries of the `collectFocalLevels`
loop ("Levels on chart"). `dealerPostureLine` / "GEX posture" is the same class and was already
fixed by PR #7166. Each of the others is a distinct call site with its own fixture/verification
burden and is left for a follow-up finding rather than bundled into this one-issue PR.

**Fix:** marked the `add(flow)` call `{ reserved: true }`, matching the Break-watch/
Counter-thesis/dealer-posture precedent in the same function:

```ts
const flow = flowNarrative(ctx, play);
if (flow && !bullets.some((b) => /HELIX tape/i.test(b))) add(flow, { reserved: true });
```

**Fix rationale:** `flowNarrative` renders exactly one bullet (the "HELIX tape" line, optionally
with inline deduped anomaly/notable-print detail appended inside the same string) — the same shape
as Break watch/Counter-thesis/dealer-posture (a single, always-shown disclosure line), not an
unbounded list like `meridianPeerEarningsCoaching`'s peer set (which was instead moved into its own
uncapped section). `reserved: true` is the minimal, most consistent change: it reuses the exact
mechanism already proven correct for the three sibling always-shown bullets in this function, with
no new section, no new render path, and no change to bullet ordering.

**Evidence (RED → GREEN):**
- Added a regression test to `src/lib/swing/play-brief-narrative.test.ts`:
  `"tradeManagerNarrativeSection: HELIX tape flow bullet survives MAX_BULLETS when 14+ other
  coaching bullets already fired (2026-11-01)"` — the same "rich Vector data" MAX_BULLETS fixture
  used by the sibling Break-watch/Counter-thesis test, with a real, LONG-conflicting
  `ecosystem.recent_flow`. Asserts the HELIX tape bullet's index in the rendered list is `>= 14`
  (proving the cap was genuinely full before the call site ran) **and** that `/HELIX tape/i` is
  present in the body.
- **RED** (fix temporarily reverted — `add(flow)` without `{ reserved: true }`): ran
  `npx tsx --experimental-test-module-mocks --test --test-name-pattern "HELIX tape flow bullet
  survives MAX_BULLETS" src/lib/swing/play-brief-narrative.test.ts` → **0 pass / 1 fail** (bullet
  entirely absent from the rendered body).
- **GREEN** (fix restored): same command → **1/1 pass**.
- Full file suite: `npx tsx --experimental-test-module-mocks --test
  src/lib/swing/play-brief-narrative.test.ts` → **172/172 pass**.
- Combined with `play-brief-intel-collapse.test.ts` (the collapse-note consumer): **178/178 pass**.
- Whole `play-brief*` suite (21 files): **1271/1271 pass**.
- `npx tsc --noEmit`: clean.
