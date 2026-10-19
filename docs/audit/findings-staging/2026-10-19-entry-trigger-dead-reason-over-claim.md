## 2026-10-19 — [FINDING, P3 Largo/Swing] Watch-levels "Entry trigger" bullet claimed a live, still-forming play's trigger "no longer fires the setup" — FIXED

> **kind:** `FINDING`

| **Status** | FIXED |
|---|---|

**Severity:** P3 — member-facing narrative self-contradiction on the live Ask Largo swing
play-brief, not a data-correctness or gating bug (the real entry/commit logic was never affected,
only the prose describing it).

**What's wrong.** `entryTriggerDeadReason()` (`src/lib/swing/play-brief-intel.ts`) decides whether
the Watch-levels "Entry trigger" bullet should say a trigger level "no longer fires the setup." It
was driven entirely by `gateFramingMootReason()` (`src/lib/swing/entry-enterability.ts`), which
returns non-null for **seven** distinct cases: the 4 genuinely-dead ones from `deadPlayReason`
(INVALIDATED / entry-window-expired / contract-expired / EXTENDED-chase) **plus three more** added
in a 2026-10-18 widening — `setupState === "FORMING"`, `aboveFloor === false`, and a
legacy-exempt-only `gateBlocks` case. That function's own doc comment is explicit that the three
added cases mean the play "is very much still live, just not yet enterable" — the opposite of
"no longer fires" — but `entryTriggerDeadReason` appended the same "— this level no longer fires
the setup" tail to every non-null case alike, dead or not.

**Live repro** (production, `GET /api/market/swing/play-brief`, EWY:COMMIT, 2026-10-19): the
**Entry** section correctly states *"Entry window closes 2026-10-21 09:15 ET (2 days left) — stale
after that, wait for a fresh setup"* — the window is open. Two sections later, **Watch levels**
rendered, for the identical price level: *"Entry trigger: **155.32** — Break/reclaim below, but
thesis still forming — not yet at trigger — this level no longer fires the setup."* The same brief
asserts the window is open and that the trigger is permanently dead, about the same play, in the
same response.

**Root cause.** The 2026-10-18 widening of `gateFramingMootReason` was a real, correct fix for a
different bug (a below-floor TRIGGERED/AT_TRIGGER play's Verdict section said the real blocker was
the score floor while the Entry-trigger bullet claimed an unqualified "this is what actually fires
the setup" — live repro TSM). That fix was shared across three call sites
(`watchEntrySection`/`watchGateCoaching`/`entryTriggerDeadReason`) without noticing that the other
two call sites only ever render the gate-moot *reason text* itself, while `entryTriggerDeadReason`
additionally tacks on a *permanence claim* ("no longer fires") that is only true for the original
4 dead cases, never for the 3 added "still live, not yet enterable" ones.

**Fix.** `entryTriggerDeadReason` now separately computes `deadPlayReason(play) != null`
(`isGenuinelyDead`) and only appends "— this level no longer fires the setup" when that flag is
true (or the independent, always-genuinely-stale `legacyPinnedStale` case) — `gateFramingMootReason`
returns `deadPlayReason(play)` verbatim when it's non-null, so the two are the same string whenever
both fire, with no duplicated branch logic needed. For the 3 "framing-moot but alive" cases
(FORMING / below-floor / legacy-exempt-only, when not also pinned-stale), the function now returns
the reason text alone, with no permanence claim — preserving the 2026-10-18 TSM fix's disclosure
while dropping the false claim it accidentally introduced.

**Evidence.** `src/lib/swing/play-brief-intel.test.ts`'s two existing regression tests for this
exact codepath (below-floor and FORMING) asserted the buggy text (`/this level no longer fires the
setup/`); flipped to assert the corrected text instead and prove RED on the pre-fix source via
`git stash` (2/268 fail — the below-floor and FORMING cases, nothing else) and GREEN post-fix
(268/268). The UNH live-repro composed test (Legacy-pinned-stale + legacy-exempt-only gate-moot,
both facts disclosed together) is unaffected — that case is still genuinely stale, so the
permanence claim there remains correct. `npx tsc --noEmit` clean; `entry-enterability.test.ts` +
`play-brief.test.ts` + `play-brief-narrative-coaching.test.ts` (365 tests, the other two
`gateFramingMootReason` call sites) all still pass unchanged.

Found via this session's standing Ask Largo deep-dive mandate (live play-brief envelope read
across 6 production positions, cross-checked against `docs/audit/LARGO-PRODUCT-CONTRACT.md`),
independently adversarially verified (5/5 verification votes confirmed) before fixing.
