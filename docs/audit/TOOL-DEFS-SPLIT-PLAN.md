# tool-defs.ts / product-reads.ts — split plan

**Status: analysis complete. Recommendation: DO NOT DO IT (tool-defs.ts). DO NOT DO IT YET (product-reads.ts).**
Measured 2026-08-21 against `origin/main` @ `f9ec3de5`, Node v20.20.2 (`/opt/node20/bin`).
No code was moved. One local throwaway worktree was used to measure migration cost; nothing was pushed.

---

## 0. Answer first

| Question asked | Measured answer |
|---|---|
| Of the open PRs touching `tool-defs.ts`, how many collisions does a per-product split eliminate? | **0 of 7.** All 7 pairwise conflicts inside `tool-defs.ts` are **intra-lane** (vector×vector, helix×helix). Cross-lane conflicts in that file: **zero**. |
| Same for `product-reads.ts`? | **2 of 5** — and both are collisions in the shared **import header at line 8**, not in the registry body. |
| How big is the honest `shared.ts`? | `tool-defs.ts`: 2 of 127 tools. But the bucket that decides this is not `shared` — it is **`unattributed`: 108 of 127 (85%)**. |
| How many open PRs need a non-trivial rebase to migrate? | **22 of 38** open PRs (all five lanes). Measured, not estimated — see §5. |

**The premise does not survive measurement.** `tool-defs.ts` is the most-*touched* file in the fleet's
open work, and that part of the chokepoint memo is correct. It is not the file the fleet is
*conflicting* on. Of the 21 currently-conflicted open PRs, **exactly one** (#2432) has a conflict in
`tool-defs.ts`, **zero** have one in `product-reads.ts`, and **19 conflict on nothing but
`docs/audit/FINDINGS.md`**.

The 73% statistic in the brief ("14 of 19 conflicted PRs touch one of those two files") is true and
non-causal. Those PRs do touch the two registries; they conflict somewhere else.

---

## 1. What is actually conflicting

Every open PR merged against `origin/main` with `git merge-tree --write-tree`, conflicted paths
taken from the machine-readable section of the output (not the `Auto-merging` chatter, which lists
files that merged *successfully*).

**38 open PRs · 21 conflicted vs `main`.** Conflicted-file frequency, whole set:

| PRs | File |
|---:|---|
| **20** | `docs/audit/FINDINGS.md` |
| 1 | `src/lib/largo/tool-defs.ts`  *(#2432 only)* |
| 1 | `src/lib/largo/run-tool.ts`  *(#2432 only)* |
| 1 | `src/features/vector/components/VectorChart.tsx`  *(#2331, a `cursor/` PR, unrelated)* |

19 of the 21 conflicted PRs conflict on **FINDINGS.md and nothing else**:
`#2427 #2435 #2446 #2451 #2480 #2485 #2487 #2490 #2501 #2502 #2509 #2511 #2515 #2519 #2520 #2521 #2522 #2523 #2525`.

`_COMMON.md` rule 4 already names this — *"FINDINGS.md conflicts with every other lane — not your
bug"* — and `scripts/audit/findings-merge-resolve.mjs` already exists to resolve it. The fleet's
merge friction is the file the standing rules already say is the problem. The registry split would
not touch it.

### 1a. The one real `tool-defs.ts` conflict is intra-lane

**#2432** `claude/meridian-largo-uw-earnings-units` — 3 changed lines in `tool-defs.ts`
(`get_earnings`, `get_earnings_history`, `get_earnings_market`). It conflicts because Batch 5
(#2476, *"earnings integrity"*) landed a superset of the same description edits while #2432 was
open. **Meridian versus meridian.** Filing meridian's tools in `tool-defs.meridian.ts` puts both
sides of that conflict in the same new file. It changes nothing.

### 1b. Contention *between* open PRs, after rebase

Pairwise merge of every open-PR pair, each first rebased onto current `main` (FINDINGS.md excluded
as a blocker so the registry contention is visible underneath it):

| File | PRs modelled | Pairs tested | Conflicting in-file | Cross-lane | Intra-lane |
|---|---:|---:|---:|---:|---:|
| `tool-defs.ts` | 17 (of 18; #2432 excluded — real blocker) | 136 | **7** | **0** | 7 |
| `product-reads.ts` | 11 | 55 | **5** | 2 | 3 |

All seven `tool-defs.ts` pairs:

```
#2427(vector)   x #2435(vector)     INTRA  get_vector_pulse,get_vector_full_state  vs get_vector_full_state
#2427(vector)   x #2522(vector)     INTRA  get_vector_pulse,get_vector_full_state  vs get_vector_pulse,get_vector_full_state
#2435(vector)   x #2522(vector)     INTRA  get_vector_full_state                   vs get_vector_pulse,get_vector_full_state
#2451(vector)   x #2515(vector)     INTRA  get_vector_analytics                    vs get_vector_analytics
#2485(helix)    x #2520(helix)      INTRA  get_helix_tape_analytics                vs get_postgres_flows,get_helix_tape_analytics,get_flow_tape
#2509(helix)    x #2530(helix)      INTRA  get_helix_signal_outcomes,get_helix_derived vs get_helix_signal_outcomes
#2509(helix)    x #2532(helix)      INTRA  get_helix_signal_outcomes,get_helix_derived vs get_helix_derived
```

Six of the seven are two PRs editing **literally the same tool**. No file boundary separates a lane
from itself.

And the five in `product-reads.ts`:

```
#2425(thermal)  x #2427(vector)     CROSS  — collision is at line 8, the import block
#2425(thermal)  x #2522(vector)     CROSS  — same import block
#2480(nighthawk) x #2490(nighthawk) INTRA
#2480(nighthawk) x #2495(nighthawk) INTRA
#2490(nighthawk) x #2495(nighthawk) INTRA
```

The two cross-lane pairs are the only contention in either file that a split would remove, and
their cause is a one-line import next to `VECTOR_FRACTION_DP` — the function bodies (`vectorPulseForLargo`
at L473–561 vs `thermalCompareForLargo` at L847+) never come near each other. Cost to resolve by
hand today: keep both import lines.

### 1c. The chokepoint ranking, with FINDINGS.md left in

Across the **32 open agent PRs** (`claude/*`):

| PRs | Lanes | File |
|---:|---:|---|
| **28** | 6 | `docs/audit/FINDINGS.md` |
| 18 | 5 | `src/lib/largo/tool-defs.ts` |
| 11 | 4 | `src/lib/largo/product-reads.ts` |
| 4 | 1 | `src/lib/largo/helix-tape-analytics.ts` |
| 4 | 1 | `src/lib/largo/contract/session-anchor.test.ts` |

The memo's shape is right and the ordering is right once the known-issue file is included. The
inference from *touched* to *conflicting* is the step that does not hold.

*(Reproduction note: `scripts/audit/agent-pr-sweep.mjs --chokepoints` could not be used — #2531
`feat/sweep-chokepoints` is still open, and `docs/audit/MERGE-CHOKEPOINTS.md` is not on `main`.
The open-PR roster here was reconstructed from git refs: a PR is open iff GitHub still publishes
`refs/pull/N/merge`. Validated against the brief's own counts — it yields 32 open agent PRs / 18
touching `tool-defs.ts` / 11 touching `product-reads.ts` / 20 conflicted, against the brief's
30 / 16 / 9 / 19: a uniform +2 offset, consistent with #2530 and #2532 having opened since the memo
was written. Conflict states are measured directly with `git merge-tree`, not inferred.)*

---

## 2. Ownership evidence

### 2a. The finding that governs everything else: there is almost no lane history to read

The lane fleet is **one day old**. The earliest `claude/<lane>-*` branch in the repo is
`claude/seo-homepage-cls-transform-animations`, first commit **2026-08-21T02:39Z** — about eight
hours before this analysis. `tool-defs.ts` has 74 commits on `main` going back to 2026-06-17, and
essentially all of them predate the existence of lanes.

So "which lane edits this tool" is not answerable from `main`'s history for most of the file. It is
answerable only from the fleet's own branches. Attribution here uses all **90** `claude/*` branches
(merged and open) plus the open non-`claude` PRs, mapping every changed line to its enclosing
`t(...)` block at both diff sides.

Per the standing rule that absence is a finding, a tool no lane branch has touched is recorded as
**unattributed**, never folded into `shared`.

### 2b. `tool-defs.ts` — 127 tools

| Bucket | Tools | Share |
|---|---:|---:|
| helix | 6 | 4.7% |
| meridian | 4 | 3.1% |
| nighthawk | 3 | 2.4% |
| vector | 3 | 2.4% |
| thermal | 1 | 0.8% |
| **shared** (≥2 lanes) | **2** | **1.6%** |
| **unattributed** (no lane has ever touched it) | **108** | **85.0%** |

The brief asked for the size of `shared.ts` because that is the number the decision turns on. It is
2 — and it is the wrong number to watch, because the residual that actually decides this is
`unattributed` at 108. Age of that bucket, from last recorded edit of the block:

| ≤7d | 8–30d | 31–60d | >60d |
|---:|---:|---:|---:|
| 1 | 10 | 30 | **67** |

Two-thirds of the file has not been edited in two months and no lane has ever claimed it. A
"per-product split" of `tool-defs.ts` is, measured, a rename of 85% of the file to
`tool-defs.unattributed.ts` plus five small files holding 17 tools between them.

The 19 blocks with real evidence:

| tool | verdict | lane branches (m = merged, o = open) | commits on main | last edit | days |
|---|---|---|---:|---|---:|
| `get_flow_brief` | **helix** | helix:5m | 2 | 2026-08-20 | 0 |
| `get_flow_tape` | **helix** | helix:1o | 4 | 2026-08-12 | 8 |
| `get_helix_derived` | **helix** | helix:5m helix:2o | 2 | 2026-08-20 | 0 |
| `get_helix_signal_outcomes` | **helix** | helix:4m helix:2o | 2 | 2026-08-20 | 0 |
| `get_helix_tape_analytics` | **helix** | helix:6m helix:2o | 4 | 2026-08-20 | 0 |
| `get_postgres_flows` | **helix** | helix:1o | 2 | 2026-07-05 | 47 |
| `get_earnings` | **meridian** | meridian:2o | 4 | 2026-08-20 | 0 |
| `get_earnings_calendar` | **meridian** | meridian:1m | 2 | 2026-08-20 | 0 |
| `get_earnings_history` | **meridian** | meridian:2o | 3 | 2026-08-20 | 0 |
| `get_earnings_market` | **meridian** | meridian:1m meridian:2o | 3 | 2026-08-21 | 0 |
| `get_gate_blocked_value` | **nighthawk** | nighthawk:1o | 1 | 2026-08-10 | 10 |
| `get_zerodte_plays` | **nighthawk** | nighthawk:1o | 4 | 2026-07-17 | 34 |
| `get_zerodte_rejections` | **nighthawk** | nighthawk:1o | 2 | 2026-07-06 | 46 |
| `get_positioning` | **thermal** | thermal:1o | 3 | 2026-07-20 | 32 |
| `get_vector_analytics` | **vector** | vector:2o | 1 | 2026-08-10 | 11 |
| `get_vector_full_state` | **vector** | vector:3o | 2 | 2026-08-20 | 0 |
| `get_vector_pulse` | **vector** | vector:2o | 1 | 2026-08-10 | 11 |
| `get_helix_thermal_compare` | **shared** | thermal:2m helix:1o | 3 | 2026-08-20 | 0 |
| `get_thermal_compare` | **shared** | helix:1m thermal:1m thermal:2o | 1 | 2026-08-12 | 9 |

Two observations worth carrying forward:

- **The tool-name prefix is not the owning lane.** `get_postgres_flows` and `get_flow_tape` are
  helix's. `spxPinForLargo` / `spxPulseForLargo` in `product-reads.ts` are edited by
  `claude/vector-largo-pin-precision`. The brief's worry that names do not group cleanly by product
  is correct, and it is worse than a naming problem: the two cases where a name *does* suggest an
  owner (`get_helix_thermal_compare`, `get_thermal_compare`) are precisely the two genuinely
  shared blocks.
- **Only 19 of 127 tools have any lane-edit evidence at all**, and 22 open PRs are competing over
  them. The contention is not spread across a 1154-line registry. It is concentrated in about 15% of it.

### 2c. `product-reads.ts` — 15 exported functions (16 blocks incl. the internal `compactSwingLane`)

| tool | verdict | lane branches | commits on main | last edit | days |
|---|---|---|---:|---|---:|
| `flowBriefForLargo` | **helix** | helix:5m | 2 | 2026-08-20 | 0 |
| `helixDerivedForLargo` | **helix** | helix:5m helix:2o | 3 | 2026-08-20 | 0 |
| `bangerBoardForLargo` | **nighthawk** | nighthawk:1m nighthawk:2o | 3 | 2026-08-20 | 0 |
| `horizonOutcomesForLargo` | **nighthawk** | nighthawk:1o | 3 | 2026-08-20 | 0 |
| `nighthawkHorizonsForLargo` | **nighthawk** | nighthawk:3m nighthawk:1o | 3 | 2026-08-20 | 0 |
| `swingHorizonForLargo` | **nighthawk** | nighthawk:1o | 1 | 2026-08-05 | 15 |
| `zerodteRecordForLargo` | **nighthawk** | nighthawk:2m nighthawk:1o | 2 | 2026-08-20 | 0 |
| `spxPinForLargo` | **vector** | vector:1m | 2 | 2026-08-20 | 0 |
| `spxPulseForLargo` | **vector** | vector:1m | 2 | 2026-08-20 | 0 |
| `vectorPulseForLargo` | **vector** | vector:2o | 2 | 2026-08-10 | 11 |
| `helixSignalOutcomesForLargo` | **shared** | helix:4m vector:1m helix:2o | 3 | 2026-08-20 | 0 |
| `helixTapeAnalyticsForLargo` | **shared** | helix:6m thermal:1m helix:1o thermal:2o | 4 | 2026-08-20 | 0 |
| `thermalCompareForLargo` | **shared** | helix:1m thermal:1m thermal:2o | 1 | 2026-08-12 | 9 |
| `compactSwingLane` | — | — | 1 | 2026-08-05 | 16 |
| `cortexDecisionForLargo` | — | — | 1 | 2026-08-05 | 16 |
| `vectorFullStateForLargo` | — | — | 1 | 2026-08-20 | 1 |

| Bucket | Blocks | Lines |
|---|---:|---:|
| nighthawk | 5 | 239 |
| vector | 3 | 112 |
| helix | 2 | 176 |
| **shared** | **3** | **238** |
| unattributed | 3 | 80 |

This file *does* split more cleanly than `tool-defs.ts` on the ownership axis — only 3 of 16 blocks
are unattributed, against 108 of 127. That is the good news and it is real. The bad news is the
shared bucket: **238 of the 845 lines that fall inside a mapped block (28%)** land in `shared`, and they are not incidental.
`helixTapeAnalyticsForLargo` is edited by helix (6 branches) *and* thermal (3);
`thermalCompareForLargo` by thermal and helix; `helixSignalOutcomesForLargo` by helix and vector.
Those are the file's largest functions and its hottest.

---

## 3. Projected effect on the current open PRs

Given the CURRENT 38 open PRs, computed rather than estimated:

**`tool-defs.ts`**

| | count |
|---|---:|
| Open PRs touching the file | 18 |
| PRs whose merge into `main` currently conflicts *in this file* | **1** (#2432, intra-lane) |
| Pairwise PR×PR conflicts inside this file after rebase | 7 |
| …of those, **cross-lane** (i.e. removable by a per-product split) | **0** |
| Collisions the split eliminates | **0 of 7 (0%)** |

**`product-reads.ts`**

| | count |
|---|---:|
| Open PRs touching the file | 11 |
| PRs whose merge into `main` currently conflicts *in this file* | **0** |
| Pairwise PR×PR conflicts inside this file after rebase | 5 |
| …of those, cross-lane | 2 |
| Collisions the split eliminates | **2 of 5 (40%)** — both import-header, both one-line resolutions |

The brief set the bar itself: *"If the answer is 'most', the split is worth a disruptive migration.
If it is 'half', it probably is not."* The answers are **0%** and **40%**.

---

## 4. The proposed grouping (for the record, since it was asked for)

Had the numbers come out the other way, this is the grouping the evidence supports. It is recorded
so a future decision does not have to re-derive it, not because it should be executed now.

```
src/lib/largo/tool-defs/
  index.ts        barrel: LARGO_TOOL_DEFS = [...core, ...helix, ...meridian, ...]
  core.ts         108 tools — no lane has ever edited them (67 untouched >60d)
  shared.ts         2 tools — get_thermal_compare, get_helix_thermal_compare
  helix.ts          6 tools
  meridian.ts       4 tools
  nighthawk.ts      3 tools
  vector.ts         3 tools
  thermal.ts        1 tool
```

`core.ts` is **not** `shared.ts`, and the distinction must survive into the filenames. `shared` means
"two lanes provably fight over this". `core` means "we have no evidence anyone owns this". Collapsing
them would report a 110-tool shared bucket and make the split look even less attractive than it is,
for the wrong reason.

Note also that the file already carries a grouping — `TOOL_GROUPS` (`spx_desk`, `flow_analysis`,
`stock_analysis`, `vol_analysis`, `news_events`, `fundamental`, `platform`, `screener`) — and it is
by capability domain, not by product lane, with tools deliberately in more than one group
(`get_gex` and `get_greek_flow` are each in two). A per-lane file split therefore cannot reuse it,
and would introduce a second, competing decomposition of the same 127 tools alongside the seven
`*_ENGINE_TOOL_NAMES` cohort lists (plus `BIE_TOOL_NAMES`) further down the file. Those lists carry long doc comments
explaining exactly why each is *not* derived from `TOOL_GROUPS`. A third axis over the same objects
is a real design cost, not just a migration cost.

---

## 5. Migration cost — measured

A throwaway worktree off `origin/main` extracted the six helix-owned tools into
`src/lib/largo/tool-defs.helix.ts` with a re-export from the barrel — the smallest honest slice of
the proposed split, 1/7th of the work. Every helix PR was then merge-tested against it.

| PR | onto `main` today | onto the split |
|---|---|---|
| #2485 `helix-route-coverage` | clean | **CONFLICT** `tool-defs.ts` |
| #2509 `helix-largo-session-anchor` | clean | **CONFLICT** `tool-defs.ts` |
| #2520 `helix-skew-authority` | clean | **CONFLICT** `tool-defs.ts` |
| #2528 `helix-compare-population` | clean | clean *(its tool stayed behind in `shared`)* |
| #2530 `helix-signal-type-breakdown` | clean | **CONFLICT** `tool-defs.ts` |
| #2532 `helix-derived-silent-caps` | clean | **CONFLICT** `tool-defs.ts` |
| #2427 (vector, control) | clean | clean |
| #2519 (nighthawk, control) | clean | clean |

**One seventh of the split converts five currently-clean PRs into conflicted ones.**

And the conflict is the bad kind. Git does not follow content between files, so the PR's edit
reappears as an *insertion* into `tool-defs.ts` at a location the tool no longer occupies, against
the split's deletion:

```
<<<<<<< (split)
=======
    "get_helix_signal_outcomes",
    "HELIX velocity/split-flow signal follow-through tracker — ...",
    { limit: { type: "integer", default: 50 } }
  ),
>>>>>>> (#2530)
```

Resolving that means discarding the hunk where git offers it and re-applying it by hand in
`tool-defs.helix.ts`. There is no `-X` strategy, no `rerere` entry and no rebase flag that does it,
because from git's point of view nothing moved — one file shrank and another appeared.

**Scope of that cost: 22 of 38 open PRs** touch one of the two files and would need this treatment —
7 nighthawk, 6 helix, 5 vector, 2 meridian, 2 thermal (7 of the 22 touch both files). Rename
detection does not help: `tool-defs.ts` splitting seven ways means at most one target is scored as
the rename and the other six are new files.

### The recipe, if it is ever run

For a lane whose hunk moves:

1. `git fetch origin main && git rebase origin/main` — expect a conflict in `tool-defs.ts` with an
   empty "ours" side.
2. Copy your `+` lines out of the conflict block. Take the split's side for the file itself
   (`git checkout --ours src/lib/largo/tool-defs.ts`).
3. Re-apply your edit to the same `t("<tool>", ...)` block in `src/lib/largo/tool-defs.<lane>.ts`.
4. `npm test -- tool-defs` — `tool-defs.test.ts` already asserts every `*_ENGINE_TOOL_NAMES` list is
   a subset of its `TOOL_GROUPS` entry, so a tool dropped or duplicated by a bad resolution fails
   there rather than in production.
5. `git rebase --continue`.

Steps 2–3 are manual per hunk. That is the cost the fleet would pay, once per PR, for the numbers in §3.

---

## 6. `product-reads.ts` — should it go first, and alone?

It is the better candidate on every axis: 3 unattributed of 16 rather than 108 of 127, 11 PRs rather
than 18, and its cross-lane contention is nonzero. **It still should not go first, because it should
not go at all yet:**

- It has produced **zero** conflicts against `main` across all 38 open PRs.
- Its 5 pairwise conflicts are 3 intra-nighthawk and 2 import-header.
- Its `shared` bucket is 28% of the attributed line mass and holds the three hottest functions. A
  split that leaves `helixTapeAnalyticsForLargo`, `thermalCompareForLargo` and
  `helixSignalOutcomesForLargo` in one shared file leaves helix, thermal and vector still meeting in
  it — which is the outcome the brief specifically warned about.

The two-line fix that captures its entire measurable benefit: **stop putting shared imports in one
block.** Both cross-lane collisions are lanes adding an import next to `VECTOR_FRACTION_DP`. Group
imports by product with a blank line between groups and those two conflicts stop happening, at a
cost of one commit and zero rebases.

---

## 7. Recommendation

### DO NOT DO IT.

Not for `tool-defs.ts`, and not for `product-reads.ts` yet.

The argument, entirely from the numbers above:

1. **It does not fix the thing it was proposed to fix.** 0 of 7 `tool-defs.ts` collisions removed;
   0 cross-lane conflicts exist in that file to remove. 2 of 5 in `product-reads.ts`, both trivial.
2. **It makes things worse in the near term.** 1/7th of the split, measured, turned 5 clean PRs into
   conflicted ones. The full split would put 22 of 38 open PRs through a manual, per-hunk
   re-application that no rebase flag automates.
3. **85% of `tool-defs.ts` has no owner to give it to.** The split's biggest output file would be
   `core.ts` with 108 tools, 67 of them untouched for over two months. That is not a decomposition;
   it is a rename.
4. **The actual chokepoint is already named and already tooled.** 20 of 21 conflicted PRs conflict
   on `docs/audit/FINDINGS.md`. `_COMMON.md` rule 4 says so and
   `scripts/audit/findings-merge-resolve.mjs` handles it. Effort spent on the registries is effort
   not spent there.
5. **Intra-lane contention is the fleet's real registry cost, and no file boundary addresses it.**
   Six of the seven `tool-defs.ts` pairs are two PRs from one lane editing the same tool —
   three vector PRs on `get_vector_full_state`, three helix PRs across
   `get_helix_signal_outcomes` / `get_helix_derived`. That is a lane running several concurrent PRs
   over one tool, and it is fixed by sequencing within the lane, not by moving the tool.

### What to do instead

In descending order of measured value per unit of disruption:

1. **Nothing, for the registries.** They are working. The release sequencing already in place is the
   correct control for a shared append-only registry, and the conflict data says it is holding.
2. **Land #2531 and add FINDINGS.md to the chokepoint report.** The sweep's chokepoint view
   currently omits the file responsible for 20 of 21 conflicts. Reporting the top-touched file while
   the top-*conflicting* file sits outside the frame is how this brief came to be written.
3. **Group the `product-reads.ts` import block by product**, one blank line between groups. One
   commit, no rebases, removes both cross-lane collisions in that file.
4. **Sequence within a lane before sequencing across lanes.** Vector has three open PRs on
   `get_vector_full_state`; helix has three across two adjacent tools. Those are self-collisions.

### The condition under which to revisit

Re-run this analysis and reconsider when **cross-lane conflicts inside `tool-defs.ts` exceed
intra-lane conflicts over a rolling 50 open agent PRs** — today the count is 0 cross vs 7 intra. The
mechanism that would produce that shift is lanes *adding* tools rather than editing existing ones:
across all 38 open PRs, **zero new `t(...)` blocks are being added**, so the append-to-the-end
collision that makes registry splits pay off is not happening yet. When a fleet cycle lands more
than a handful of new tools per week, this stops being true and the calculation changes.

Also revisit if `core.ts`'s share falls below ~50% — i.e. once lanes have actually touched half the
registry and there is ownership evidence to split on. Today it is 15%, and it is 15% because the
lane fleet is a day old, not because the tools are genuinely ownerless.

---

## Appendix A — method

- Repo read-only at `origin/main` `f9ec3de5`; full history (`git fetch --unshallow`, 3,038 commits).
- Node **v20.20.2** from `/opt/node20/bin` (`/opt/nvm/versions/node/v20.20.2/bin` from `_COMMON.md`
  rule 2 does not exist in this container; `/opt/nvm/versions` is absent entirely and the default is
  v22.22.2 — flagged rather than fallen back on).
- Open-PR roster: `refs/pull/N/merge` present ⇒ open. Merged/closed PRs identified from `(#N)` in
  `main`'s squash subjects. `refs/pull/N/merge` goes **stale** rather than disappearing when a PR
  becomes conflicted — 21 of the 38 have a merge ref and still conflict — so conflict state is never
  read from the ref, only openness.
- Conflicts: `git merge-tree --write-tree --name-only`, conflicted paths read from the machine
  section only. Pairwise tests rebase both sides onto `main` first (`git commit-tree` on the merged
  tree) so PR-vs-PR contention is not confounded by `main` drift under an older branch point.
- Block attribution: every changed line mapped to its enclosing `t(...)` call (paren-balanced) or
  top-level function, on **both** diff sides, at that commit's own version of the file.
- Lane attribution: branch name only (`claude/<lane>-*`), across all 90 lane branches, merged and
  open. Commit-subject keyword inference was tried and **discarded** — it attributed 90 touches to
  `spx` from subject text alone, on commits that predate the lane structure by two months. A tool
  with no lane-branch evidence is `unattributed`, never `shared`.

## Appendix B — what could not be verified

- **`scripts/audit/agent-pr-sweep.mjs` could not be run.** It requires GitHub API access; this
  session has anonymous git read only (`add_repo` with `access:"push"` was refused by the permission
  layer), so the API returns 403. The sweep correctly refuses to print a roster it cannot fetch. All
  PR state here is derived from git refs instead, and cross-checked against the brief's own counts
  (§1c note).
- **`docs/audit/MERGE-CHOKEPOINTS.md` does not exist on `main`** and #2531 has not landed, so the
  original measurement could not be read directly or diffed against this one.
- **Nothing here is validated live**, and nothing needs to be — this is a static analysis of git
  state, not a behaviour claim. `_COMMON.md` rule 6 does not apply.
