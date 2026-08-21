# tool-defs.ts / product-reads.ts — split plan

**Recommendation: DO NOT DO IT.** Not `tool-defs.ts`, and not `product-reads.ts` first.
The measured fix for the release jam is one line of process, not a migration.

Measured 2026-08-21 ~10:45Z against `origin/main` @ `fbfa7d23`, Node v20.20.2 (`/opt/node20/bin`).
No code moved. Three throwaway worktrees were used to measure migration cost and to simulate
release passes; nothing was pushed. Revised after the coordinator's 10:39Z update (lanes rebased,
21 green drafts, "wait for single digits" trigger withdrawn) — that update changed the urgency and
the numbers, and it is answered directly in §3.

---

## 0. The three answers, first

**1. How many of the 127 tools land in `shared.ts`?  → 1.**
Not 60, not 30. One: `get_helix_thermal_compare` (helix and thermal both edit it). But `shared` is
not the bucket that decides this. **`unattributed` is 108 of 127 (85%)** — tools no lane branch has
ever touched, 67 of them untouched for over 60 days. The split's largest output file would be
`core.ts` holding 85% of the registry. That is a rename, not a decomposition.

**2. Of the green PRs, how many become mutually releasable after the split?  → Fewer. 19 → 10.**
*(Re-measured 10:55Z on a queue that has since grown to 35: **5 → 26** with the resolver, no split.
The ratio is unchanged and the conclusion is unchanged.)*
Simulated as an actual release pass — merge each of the 28 open agent PRs into main in turn, count
how many land without a human:

| Base | FINDINGS.md policy | Merged in one pass |
|---|---|---:|
| current `main` | strict (any conflict stops) | **5 / 35** ← today |
| current `main` | auto-resolved (`findings-merge-resolve.mjs`) | **26 / 35** |
| **after the full split** | strict | 2 / 28 |
| **after the full split** | auto-resolved | **10 / 28** |
| after splitting `product-reads.ts` only | auto-resolved | **16 / 28** |

Rows 1–2 are re-measured at 10:55Z over the current 35 open `claude/*` PRs. Rows 3–5 were measured
at 10:45Z over the 28 open then; `main` has not moved between the two (`fbfa7d23` both times), so
the split rows are directly comparable to the 19/28 they should be read against. **The queue grew
by seven PRs and the ratio did not move: 14% strict, 74% with the resolver.**

The split does not turn 1-per-pass into 8-per-pass. It turns 19-per-pass into 10-per-pass. What
turns 2 into 19 is running the FINDINGS.md resolver that already exists, inside the release pass.

**3. Is `product-reads.ts` separable and worth doing first, alone?  → Separable, yes. Worth it, no.**
It has the better ownership shape (3 unattributed of 20 blocks, against 108 of 127) and it is the
only place where a split removes any cross-lane contention at all. But it currently produces **zero
conflicts against `main`** and **zero pairwise contention** between open PRs, and splitting it alone
drops the release pass from 19 to 16. There is nothing there to buy.

---

## 1. Checking the coordinator's arithmetic, as asked

> *"Grind: ~21 sequential CI-and-merge cycles, and every merge invalidates the other 20, so each lane
> rebases roughly 20 more times. The rebase cost is O(n²)."*

**The O(n²) term is real. It is not attached to `tool-defs.ts`.**

A merge only invalidates another PR if the two actually conflict. Measured across the current open
set, after each is rebased onto `main`:

| File | Pairs tested | Conflicting pairs | Cross-lane | Intra-lane |
|---|---:|---:|---:|---:|
| `tool-defs.ts` | 78 | **1** | **0** | 1 |
| `product-reads.ts` | 15 | **0** | 0 | 0 |

One conflicting pair, and it is helix against helix (#2485 and #2520 both editing
`get_helix_tape_analytics`). **Cross-lane conflicts inside either registry: zero.** Merging a vector
PR does not invalidate a helix PR — git auto-merges them, which is exactly what row 2 of the table
in §0 shows: nineteen PRs merged sequentially, one after another, with no rebase between them.

The O(n²) rebase treadmill is `docs/audit/FINDINGS.md`. Every lane appends at the same anchor, so
every merge does invalidate every other PR — there. That is the file the quadratic cost is attached
to, `_COMMON.md` rule 4 already names it, and `scripts/audit/findings-merge-resolve.mjs` already
absorbs it. It is simply not being run inside the release pass.

**Live evidence for that, from the last hour.** At 10:39Z the sweep read `CONFLICTED 19 → 3`. By
10:45Z, after `fbfa7d23` and the merges before it landed, the same measurement reads **27
conflicted, 22 of them involving FINDINGS.md, 18 of them conflicting on FINDINGS.md and nothing
else**. Nineteen rebases were spent and the conflict count went *up*, because the merges that
happened in between re-broke the same file. That is the treadmill, observed in real time, on a file
the split does not touch.

### The withdrawn trigger

Agreed, and thank you for withdrawing it — the deadlock is real. *"Split when the chokepoint count
reaches single digits"* cannot fire, because the count only falls as PRs merge. I am not deferring
to it. The conclusion below is reached from the release-pass simulation and the pairwise conflict
data, and it would be the same conclusion if that guidance had never been written.

One thing worth separating out, though: the deadlock was in the *trigger*, not in the *repo*. The
premise underneath it — "PRs can only merge one at a time because of that file" — is the part that
does not survive measurement. Nineteen of twenty-eight merge in one pass today, on the current
layout, with no split and no rebases.

---

## 2. What is actually blocking the release pass

### Verified against the canonical sweep

`scripts/audit/agent-pr-sweep.mjs` became runnable late in this analysis (GitHub API access was
granted for the docs push). Its roster confirms the reconstruction: **37 open PRs, 26 CONFLICTED,
6 READY-BUT-DRAFT, 5 CI-RUNNING**. Re-measuring every PR the sweep calls CONFLICTED, against
`main` @ `fbfa7d23`:

| Conflicted on | PRs |
|---:|---|
| **`docs/audit/FINDINGS.md` and nothing else** | **19 of 26** |
| `tool-defs.ts` (± other files) | 3 — #2427 #2432 #2515 |
| `product-reads.test.ts` (with FINDINGS.md) | 2 — #2480 #2490 |
| `session-anchor.test.ts` | 1 — #2511 |
| `VectorChart.tsx` (a `cursor/` PR) | 1 — #2331 |
| `product-reads.ts` | **0** |

Seventy-three percent of the conflicted set is one docs file with a committed resolver. This is the
same 73% the brief attributed to the two registries — measured against what each PR actually
conflicts on rather than what it touches, it lands on a different file entirely.

### The strict-pass breakdown

From the strict pass (row 1), the 26 blocked PRs break down as:

| Blocker | PRs |
|---:|---|
| **FINDINGS.md and nothing else** | **17** |
| `tool-defs.ts` (± other files) | 5 — #2427 #2432 #2509 #2515 #2522 |
| `product-reads.test.ts` | 2 — #2480 #2490 |
| other single files | 2 — #2511 (`session-anchor.test.ts`), #2331 (`VectorChart.tsx`, a `cursor/` PR) |

Seventeen of twenty-six are one file, and it is not a registry.

Of the five that do conflict in `tool-defs.ts`, the causes are:

- **#2432** (meridian) — Batch 5 landed a superset of its own lane's `get_earnings*` edits.
  **Meridian vs meridian.**
- **#2427, #2522** (vector) — both editing `get_vector_pulse` / `get_vector_full_state`, against a
  vector change that has since landed. **Vector vs vector.**
- **#2509** (helix) — `get_helix_signal_outcomes` / `get_helix_derived` vs landed helix work.
- **#2515** (vector) — `get_vector_analytics` vs landed vector work.

Every one is a lane colliding with its own already-merged output. Filing those tools in
`tool-defs.<lane>.ts` puts both sides of each collision in the same new file.

---

## 3. Why the split makes the pass worse, measured

A throwaway worktree applied the full per-lane split — 18 tool blocks out of `tool-defs.ts` into
five lane files, 15 function blocks out of `product-reads.ts` into four — then re-ran the pass.

Git does not follow content between files. A PR's edit to a tool that moved reappears as an
*insertion* into `tool-defs.ts` at a location the tool no longer occupies, conflicting with the
split's deletion:

```
<<<<<<< (split)
=======
    "get_helix_signal_outcomes",
    "HELIX velocity/split-flow signal follow-through tracker — ...",
    { limit: { type: "integer", default: 50 } }
  ),
>>>>>>> (#2530)
```

There is no `-X` strategy, no `rerere` entry and no rebase flag that resolves that, because from
git's point of view nothing moved: one file shrank and another appeared. Resolution is manual, per
hunk, per PR.

An earlier, smaller probe isolated the effect — extracting only the six helix tools, one seventh of
the split:

| PR | onto `main` | onto the split |
|---|---|---|
| #2485, #2509, #2520, #2530, #2532 (helix) | clean | **CONFLICT** `tool-defs.ts` |
| #2528 (helix, its tool stayed in `shared`) | clean | clean |
| #2427 (vector), #2519 (nighthawk) — controls | clean | clean |

**One seventh of the split converted five clean PRs into conflicted ones.** The full split does the
same thing at scale, which is why the pass drops from 19 to 10.

**The steady-state argument does not rescue it.** *"Every PR rebases once, then collisions go to
zero"* assumes there are cross-lane collisions to remove. There are none: 0 of 1 in `tool-defs.ts`,
0 of 0 in `product-reads.ts`. The one-time cost is real and measured; the recurring saving it buys
is zero on `tool-defs.ts` and, on `product-reads.ts`, two import-header collisions that a blank line
between import groups also fixes.

---

## 4. Ownership evidence

### The finding that governs the rest: there is almost no lane history to read

The lane fleet is **one day old**. The earliest `claude/<lane>-*` branch is
`claude/seo-homepage-cls-transform-animations`, first commit **2026-08-21T02:39Z**. `tool-defs.ts`
has 74 commits on `main` going back to 2026-06-17, essentially all of them predating lanes.
Attribution therefore comes from the fleet's own branches — all **96** `claude/*` branches, merged
and open — mapping every changed line to its enclosing `t(...)` block at both diff sides.

Per rule 7, a tool no lane branch has touched is **unattributed**, never folded into `shared`.

### `tool-defs.ts` — 127 tools, 1154 lines

| Bucket | Tools | Block lines |
|---|---:|---:|
| helix | 6 | 44 |
| meridian | 4 | 8 |
| vector | 3 | 23 |
| nighthawk | 3 | 15 |
| thermal | 2 | 12 |
| **shared** (≥2 lanes) | **1** | 7 |
| **unattributed** | **108** | 389 |

Age of the unattributed bucket, from last recorded edit: 1 within 7 days, 10 at 8–30 days, 30 at
31–60 days, **67 over 60 days**.

The 19 blocks with evidence:

| tool | owner |
|---|---|
| `get_flow_brief`, `get_flow_tape`, `get_helix_derived`, `get_helix_signal_outcomes`, `get_helix_tape_analytics`, `get_postgres_flows` | helix |
| `get_earnings`, `get_earnings_calendar`, `get_earnings_history`, `get_earnings_market` | meridian |
| `get_gate_blocked_value`, `get_zerodte_plays`, `get_zerodte_rejections` | nighthawk |
| `get_vector_analytics`, `get_vector_full_state`, `get_vector_pulse` | vector |
| `get_positioning`, `get_thermal_compare` | thermal |
| `get_helix_thermal_compare` | **shared** (helix + thermal) |

**The tool-name prefix is not the owning lane.** `get_postgres_flows` and `get_flow_tape` are
helix's. In `product-reads.ts`, `spxPinForLargo` and `spxPulseForLargo` are edited by
`claude/vector-largo-pin-precision`. Your worry that the names do not group by product is correct,
and it is sharper than a naming problem: the two names that *do* advertise an owner
(`get_thermal_compare`, `get_helix_thermal_compare`) are the two most contested blocks in the file.

### `product-reads.ts` — 20 blocks (18 exported), 1041 lines

| Bucket | Blocks | Lines |
|---|---:|---:|
| nighthawk | 5 | 239 |
| thermal | 5 | 172 |
| vector | 3 | 112 |
| helix | 2 | 176 |
| **shared** | **2** | 211 |
| unattributed | 3 | 80 |

Better than `tool-defs.ts` on every axis — but the shared pair is
`helixTapeAnalyticsForLargo` (helix + thermal) and `helixSignalOutcomesForLargo` (helix + vector),
**211 of the 990 mapped lines (21%)**, and they are among the file's largest and hottest functions.
A split leaving those two in `shared.ts` leaves helix, thermal and vector still meeting inside it.

**A concrete instance of the "wrong split is worse than none" risk.** `etSessionNow`,
`ageSecondsFrom` and `expiryScopeOf` attribute cleanly to thermal — thermal introduced them
yesterday in #2425 and nobody else has touched them yet. They are generic time and scope helpers.
Edit-history attribution over a one-day-old fleet would file three shared utilities in
`product-reads.thermal.ts`, and the next lane that needs `ageSecondsFrom` imports it from another
lane's file or copies it. The data cannot currently tell "thermal owns this" from "thermal happened
to write it first", and the split has to be right about that distinction for all 20 blocks.

---

## 5. Migration cost

**22 of the 34 open PRs** touch one of the two files: 7 nighthawk, 6 helix, 5 vector, 2 meridian,
2 thermal, with 7 touching both. Each needs the manual per-hunk re-application in §3 — rename
detection does not help, because splitting one file seven ways scores at most one target as the
rename and the rest as new files.

There is also a design cost. `tool-defs.ts` already carries a decomposition: `TOOL_GROUPS`
(`spx_desk`, `flow_analysis`, `stock_analysis`, `vol_analysis`, `news_events`, `fundamental`,
`platform`, `screener`), by capability domain rather than product lane, with tools deliberately in
more than one group (`get_gex` and `get_greek_flow` are each in two). Underneath it sit seven
`*_ENGINE_TOOL_NAMES` cohort lists plus `BIE_TOOL_NAMES`, each with a long doc comment explaining
why it is *not* derived from `TOOL_GROUPS`, and `tool-defs.test.ts` asserts each stays a subset of
its group. A per-lane file split is a **third** axis over the same 127 objects, and the first two
cannot be reused for it.

---

## 6. Recommendation

### DO NOT DO IT.

1. **It does not fix the jam.** The release pass goes 19 → 10 with the split, 19 → 16 with
   `product-reads.ts` alone. Both are worse than the current layout.
2. **There is nothing for it to fix.** Cross-lane conflicts inside either registry: zero. One
   conflicting pair total, helix against helix.
3. **85% of `tool-defs.ts` has no owner to give it to**, and the ownership data that does exist is
   one day old and already mislabelling shared helpers (§4).
4. **The jam is FINDINGS.md, and the tool for it is already committed.** 18 of the 27 currently
   conflicted PRs conflict on that file and nothing else.

### What to do instead, in order

1. **Run `scripts/audit/findings-merge-resolve.mjs` inside the release pass, not beside it.**
   This is the whole finding. Measured: **2 → 19 releasable in a single pass**, no rebases, no
   migration, no freeze. If one change is made today, make this one.
2. **Then hand-resolve the five real `tool-defs.ts` conflicts** — #2427, #2432, #2509, #2515,
   #2522. Each is a lane against its own landed work, so route each back to its own lane; no
   cross-lane coordination is needed. #2480 and #2490 (`product-reads.test.ts`) and #2511
   (`session-anchor.test.ts`) are the same shape.
3. **Stop asking lanes to rebase pre-emptively.** The 19 rebases spent between 10:39Z and 10:45Z
   bought a conflict count that went from 3 to 27, because the merges underneath them re-broke
   FINDINGS.md. Rebase on demand, after a merge, only for PRs that actually conflict.
4. **Group the `product-reads.ts` import block by product**, one blank line between groups. One
   commit, no rebases; removes the only cross-lane collision class either file has produced.
5. **Land #2531 with FINDINGS.md inside the chokepoint frame.** The current report ranks by *files
   touched* and excludes the known-issue file — which is how the top-touched file came to be read as
   the top-conflicting one. Rank by *measured conflicts* (`git merge-tree` against `main`, conflicted
   paths from the machine-readable section, not the `Auto-merging` lines) and the ordering inverts.

### When to revisit

Two conditions, either one sufficient:

- **Cross-lane conflicts inside `tool-defs.ts` exceed intra-lane conflicts**, over a rolling window
  of 50 open agent PRs. Today: 0 cross, 1 intra. This is measurable from git alone and cannot
  deadlock — it does not require anything to merge first.
- **Lanes start adding tools rather than editing them.** Across all 34 open PRs, **zero new `t(...)`
  blocks are being added.** The append-to-the-end collision that makes registry splits pay off is
  not happening. When a fleet cycle lands more than a handful of new tools, the arithmetic changes
  and this should be re-run.

A third, softer signal: revisit when `core.ts`'s share would fall below ~50% — i.e. when lanes have
actually touched half the registry and there is ownership evidence to split on. Today it is 15%, and
it is 15% because the fleet is a day old, not because the tools are ownerless.

**No freeze plan is included, deliberately.** You asked for one conditional on DO IT. Publishing a
freeze recipe alongside a DO-NOT recommendation invites it to be half-executed. The migration recipe
in §3 and the grouping in §4 are enough to reconstruct one if the revisit conditions fire, and by
then the ownership data will be worth more than it is today.

---

## Appendix A — method

- Read-only clone at `origin/main` `fbfa7d23`; full history (`git fetch --unshallow`, 3,038 commits).
- Node **v20.20.2** from `/opt/node20/bin`. `_COMMON.md` rule 2's path
  (`/opt/nvm/versions/node/v20.20.2/bin`) does not exist in this container — `/opt/nvm/versions` is
  absent entirely and the default is v22.22.2. Flagged rather than fallen back on; rule 2 should be
  updated or the container fixed.
- **Open-PR roster** reconstructed from git refs, because the API is unreachable (Appendix B): a PR
  is open iff GitHub still publishes `refs/pull/N/merge`. That ref goes **stale** rather than
  disappearing when a PR becomes conflicted, so it is used only for openness; conflict state is
  always measured. Merged PRs identified from `(#N)` in `main`'s squash subjects. Validated against
  the brief's own counts at the time it was written (32/18/11/20 vs 30/16/9/19 — a uniform +2,
  matching #2530 and #2532 having opened since).
- **Conflicts:** `git merge-tree --write-tree --name-only`, conflicted paths read from the
  machine-readable section only, never from the `Auto-merging` lines (those name files that merged
  *successfully* — reading them as conflicts is what inflates a chokepoint count).
- **Release passes:** real sequential `git merge` into a scratch worktree, oldest PR first, matching
  the repo's stated landing order. `auto` policy resolves FINDINGS.md by union merge, which is what
  `findings-merge-resolve.mjs` does; any conflict elsewhere counts as blocked and the merge is
  aborted.
- **Block attribution:** every changed line mapped to its enclosing `t(...)` call (paren-balanced) or
  top-level function, on **both** diff sides, at that commit's own version of the file.
- **Lane attribution:** branch name only (`claude/<lane>-*`), across all 96 lane branches.
  Commit-subject keyword inference was tried and **discarded** — it attributed 90 touches to `spx`
  from subject text alone, on commits predating the lane structure by two months.
- **Split probes:** three scratch worktrees (helix-only, full split, `product-reads.ts`-only), each
  deleted after measurement. They measure merge behaviour, not compilation — no probe was
  type-checked, and none was pushed.

## Appendix B — what could not be verified

- **`scripts/audit/agent-pr-sweep.mjs` could not be run for most of this analysis.** It requires
  GitHub API access, which this session did not have until the docs push was authorised; until then
  the API returned 403 and the sweep correctly refused to print a roster it could not fetch. Every
  PR-state number was therefore derived from git refs and direct merge tests. Once the sweep did
  run, its roster **confirmed the reconstruction** (§2) — same open set, same conflicted set. The
  ref-based method is sound, but the sweep remains the canonical source and should be preferred
  where it is available.
- **CI status is invisible from git.** "Green" is taken from your 10:39Z report. The release-pass
  simulation runs over all 28 open `claude/*` PRs rather than a verified-green subset, so its
  denominator is 28, not 21. It measures mergeability, not test health.
- **`docs/audit/MERGE-CHOKEPOINTS.md` is not on `main`** and #2531 has not landed, so the original
  measurement could not be diffed against this one.
- **Nothing here is live-validated**, and nothing needs to be — this is static analysis of git
  state, not a behaviour claim. Rule 6 does not apply.
