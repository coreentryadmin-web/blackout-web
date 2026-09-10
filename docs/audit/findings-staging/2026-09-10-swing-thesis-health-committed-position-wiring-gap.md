> **kind:** FINDING

## Ask Largo "Thesis health" pillar breakdown is withheld for real, capital-committed swing positions but shown in full for Banger-engine rows in the same lane — SCOPED, design proposal not yet built

| | |
|---|---|
| **Status** | SCOPED — design proposal, not yet built |
| **Area** | Swing Command Deck "Thesis health" pillars (`src/lib/swing/thesis-health.ts`), fed from `src/lib/swing/live-plays.ts`'s `livePlayFromSwingPosition` via `src/features/nighthawk/command-deck/adapters.ts`'s `terminalPlayFromHorizon`, surfaced in the Ask Largo swing brief (`src/lib/swing/play-brief.ts`'s `thesisHealthSection`) |
| **Severity** | P2 (Largo/Night Hawk Swings standing ownership mandate — a real, capital-committed position gets strictly *less* Largo intelligence than an incidental Banger-engine row in the same lane; backwards priority, live-confirmed) |

### The finding (live-confirmed, not a guess)

NRG and CRWD — real open positions in the `swing_positions` Postgres table, actual member capital —
both render *"Inputs not wired for committed positions — aggregate score withheld; pillar breakdown
not shown"* in the Ask Largo brief's Thesis Health section. CLSK and DOCN — Banger-engine-origin rows
that were **never written to `swing_positions` at all** — get full 5-pillar breakdowns with deltas, in
the exact same UI lane. The platform's real, capital-committed positions are underserved relative to
a lower-stakes, different engine's incidental rows.

### Root cause — traced to the exact drop point

`computeSwingThesisHealth()` (`thesis-health.ts`) takes `setupState` (`SwingSetupState`:
FORMING/TRIGGERED/EXTENDED/INVALIDATED) and `entryStatus` (`SwingEntryState`:
PRE_TRIGGER/AT_TRIGGER/PULLBACK_TO_ENTRY/EXTENDED_CHASE). When both are `null`/`undefined`,
`setupPersistenceScore()`/`entryGeometryScore()` fall through to their `default:` case, producing the
literal labels `"unknown"`/`"n/a"` — and `thesisHealthUncalibrated()` (same file) treats those exact
label strings as proof the whole payload is uncalibrated, which is what makes `play-brief.ts`'s
`thesisHealthSection()` withhold the aggregate score and pillar breakdown.

Traced the full path from `swing_positions` to the call site:

1. **Schema**: `swing_positions`'s `CREATE TABLE` (`src/lib/db.ts` ~line 2009) has **no
   `setup_state`/`entry_status`/`signal_kinds` columns**, and `SwingPositionRow` (~line 7297) carries
   no such fields. `entry_context`/`feature_vector` (the two commit-time-frozen JSONB columns) also do
   not carry them — confirmed by grepping `commit.ts`'s `buildCommitInsert`/`buildShadowInsert`: neither
   references `SwingSetupState`/`SwingEntryState` anywhere, and `buildSwingFeatureVector`'s pinned
   `feature_vector` uses a completely different vocabulary (`pil_flow`/`pil_rel_strength`/`pil_catalyst`/
   `pil_regime` — archetype-classification pillars, not setup/entry taxonomy; see "why not just remap
   `feature_vector`" below).
2. **Read side**: `livePlayFromSwingPosition()` (`live-plays.ts`, the mapper that turns an OPEN ledger
   row into a `HorizonPlay`) never sets `setupState`/`entryStatus`/`signalKinds` on its returned object
   at all — confirmed by reading its full return block. Every consumer of that `HorizonPlay` (the
   Terminal deck adapter, the client container, the Ask Largo brief) therefore sees `undefined` for a
   committed row.
3. **Call site**: `adapters.ts`'s `terminalPlayFromHorizon()` passes `src.setupState`/`src.entryStatus`
   straight through to `computeSwingThesisHealth()` with no fallback — this is the one and only
   production call site (grepped; the other hits are test files).

For contrast, `banger-lane-merge.ts`'s `horizonPlayFromBangerPosition`/`horizonPlayFromBangerWatch`
(lines 86-87, 147-148) **hardcode** `setupState: "TRIGGERED"` / `entryStatus: "AT_TRIGGER"` on every
row they build — that is exactly why Banger-origin rows in the same lane get a full breakdown: they
carry a synthetic, always-valid setup/entry state that real ledger rows never receive.

### Why the obvious fix (Option A: default committed rows to `TRIGGERED`/`AT_TRIGGER`, mirroring Banger) is **not actually correct**

The task that produced this investigation proposed defaulting a committed-but-unwired position's
`setupState`/`entryStatus` to `"TRIGGERED"`/`"AT_TRIGGER"` on the premise that "per `serving.ts`'s own
`COMMIT_NOW` logic, a position can only reach commit from `TRIGGERED`+`AT_TRIGGER`, so this is
recovering an implied fact, not fabricating one." **Traced this premise and it does not hold:**

- `sectionForSwingPlay()` (`serving.ts`) is a **display-only router** — it decides which of the seven
  UI buckets a *pre-entry, already-produced* `HorizonPlay` shows in. `COMMIT_NOW` requires
  `setup === "TRIGGERED" && entryStatus === "AT_TRIGGER"`, yes — but that is a fact about the **board's
  serving section**, not about the real DB commit gate.
- The real commit gate — `discovery.ts`'s `commitCandidates`/`computeSwingCommitPlan`
  (`commit.ts`) — is **entirely decoupled from setup/entry taxonomy**. Grepped `commit.ts` for
  `SwingSetupState`/`SwingEntryState`/`setupState`/`entryStatus`: zero hits. The real gate is
  persistence-cleared `SwingWatchCandidate` (accumulation store: `observationCount`,
  `distinctSessionDays`, `phasesSeen`, `signalKinds` — no setup/entry field exists on this type either)
  × graduation (evidence-only since 2026-08-06, per `commit.ts`'s own header) × budget/caps/idempotency.
  `sectionForSwingPlay()` is never called anywhere in `discovery.ts`.
- So a real committed row's pre-entry board section, at the moment it committed, could in principle
  have been anything (or nothing, if no dossier existed for it that scan) — the commit path simply does
  not require `COMMIT_NOW` to have been the serving verdict. Defaulting to `TRIGGERED`/`AT_TRIGGER`
  would therefore be presenting an assumption as a recovered fact, exactly the fabrication this repo's
  product contract (`docs/audit/LARGO-PRODUCT-CONTRACT.md`) warns against ("confidence must be omitted
  when a product cannot calibrate it... an invented score... corrupts").
- This codebase has **already hit and fixed this exact class of mistake once** —
  `serving-lane.ts`'s `attachThesisExplanation()` carries a long comment (written when a prior bug —
  live committed rows losing their factors/regime explanation — was fixed on 2026-08-12) explaining
  *why it deliberately does NOT* copy `setupState`/`entryStatus`/`thesisLevel` from a matching
  same-day dossier onto a live row, even when one exists: doing so could move a MANAGING position back
  into a pre-entry section, or overwrite a real "thesis broken" with a stale pre-entry "intact". The
  same reasoning applies to inventing a synthetic `TRIGGERED`/`AT_TRIGGER` pair for the thesis-health
  pillars specifically.

### Why Option B (persist the real values at commit time) is bigger than it first looks

The real values are **not sitting in scope, unpinned, at commit time** the way the task's framing
assumed. `deriveSetupState()`/`deriveEntryPlan()` (`setup-state.ts`/`entry-model.ts`) require
`SetupStateReads`/`EntryReads` — **grounded, live price-vs-level reads** computed only in
`serving-ingest.ts`'s `swingServingMetaFromDossier()`, which today runs only on the **member-request
path** (`serving-lane.ts`, fed by `discoverSwingFromPersisted()`'s cached scan snapshot), never inside
the discovery/commit cron (`discovery.ts`) that actually builds `SwingCommitCandidate` and calls
`commit.ts`. Confirmed by grepping `discovery.ts` and `commit.ts` for any reference to
`SwingSetupState`/`SwingEntryState`: none. So threading the real value through means one of:

- **(B1) Compute setup/entry state inside the discovery cron at commit time** (new code path: the cron
  would need the same grounded price/level reads `serving-ingest.ts` uses, computed against the
  candidate's own dossier at the moment of commit) and pin it into `entry_context` or a new column.
  Requires a schema migration (`ALTER TABLE swing_positions ADD COLUMN ...` or an `entry_context` shape
  addition) plus a backfill decision for rows already open before the change ships (NRG/CRWD themselves
  would stay unwired unless backfilled, and a backfill would have to reconstruct a value that was never
  computed at the time — itself a fabrication risk for historical rows).
- **(B2) Re-derive live, post-commit, from the SAME daily discovery scan** IF the ticker still appears
  in that day's dossier set — this is exactly the mechanism `attachThesisExplanation` already uses for
  factors/regime, and exactly the mechanism its own comment explains is unsafe to extend to
  setupState/entryStatus (see above). It also silently degrades to nothing the day a committed ticker's
  thesis stops re-qualifying for that day's scan (a materially different failure mode than "never
  wired": intermittently wired, which is arguably worse to explain in the UI than consistently absent).

Neither sub-option is a small, mechanical fix; both are real product/architecture decisions about
what "setup persistence" and "entry geometry" should even *mean* for a position that has already
converted intent into capital — a pre-entry concept being asked to describe a post-entry state.

### Why not remap `feature_vector`'s `pil_*` fields (ruled out, per instruction and independently confirmed)

`buildSwingFeatureVector()`'s pinned `pil_structure`/`pil_rel_strength`/`pil_flow`/`pil_volatility`/
`pil_catalyst`/`pil_regime` (consumed by `manage-edge-reads.ts`'s `commitPillarsFromFeatureVector()`
for the MANAGE engine's own thesis-break rungs) are **archetype-classification pillar scores**
(0-1 floats measuring "how much did FLOW/STRUCTURE/CATALYST/... contribute to this name's archetype
classification at commit"), a categorically different measurement from setup maturity or entry
execution stance. There is no honest 1:1 mapping; reverse-engineering one would be inventing a
correspondence the two vocabularies were never designed to share.

### `signalKinds` — a separable, smaller-looking gap worth flagging even though it's out of scope here

`signalKinds` (drives the `flow_corroboration` pillar via `signalScore()`, whose empty-input label
`"no signals"` is also one of `thesisHealthUncalibrated()`'s trip wires) has the **same absence** on
committed rows — `livePlayFromSwingPosition` never sets it either, confirmed by grep. Unlike
setup/entry state, this one MIGHT be cheaply recoverable without a schema change: the promoting
accumulation row (`swing_candidate_accumulation`, joined via `commit.ts`'s `promote` callback ->
`markAccumPromoted`) already carries a `signal_kinds` JSONB column with exactly this thesis's lifetime
discovery provenance, and `serving-lane.ts`/`discoverSwingFromPersisted()` already join accumulation
rows onto plays by the same `swingThesisKey(ticker, direction, archetype)` used elsewhere in this file
(e.g. `cand?.signalKinds ?? p.signalKinds` at `discoverSwingFromPersisted`'s WATCH-row join). Whether
that promoted accumulation row remains a reliable, unmutated carrier of the ORIGINAL discovery-time
signal kinds after promotion was **not verified in this pass** — that verification, plus wiring the
join into the live-position path (`live-plays.ts`/`serving-lane.ts`), is exactly the kind of small,
scoped follow-up this design doc recommends starting with, separately from the larger setup/entry
question. Left honestly as "no signals" is fine per this repo's absence-over-fabrication discipline
until that join is built and verified.

### Options considered (summary)

| Option | What it does | Why not chosen (this pass) |
|---|---|---|
| A — default committed rows to `TRIGGERED`/`AT_TRIGGER` | Mirror `banger-lane-merge.ts`'s hardcode | Premise ("commit implies `COMMIT_NOW`") is FALSE for the real commit gate (traced above) — would fabricate, not recover, a fact |
| B1 — compute setup/entry state in the discovery cron at commit time, persist it | Honest, real value, forward-looking | Real code + schema change; needs the cron to gain the same grounded price/level reads `serving-ingest.ts` uses only on the request path today; open rows committed before the change need a backfill decision |
| B2 — re-derive live from the same-day dossier, like `attachThesisExplanation` does for factors/regime | No schema change | This repo's own `attachThesisExplanation` comment already documents why this specific extension is unsafe (risks reverting a managed position's section / overwriting real thesis-break state) and would be intermittently wired, not consistently absent |
| Reverse-map `feature_vector`'s `pil_*` | No schema change | No honest mapping exists; archetype-classification pillars measure something categorically different |
| (Recommended) Do not fix pillar VALUES this pass; instead scope the redesign | — | See below |

### Recommendation

Do not implement A, B1, or B2 as a quick patch this pass. The honest state of the system is: setup
maturity and entry execution stance are **pre-entry-only concepts that this codebase has never
defined an analog for post-commit**, and the existing "uncalibrated ⇒ withhold everything" behavior in
`thesisHealthUncalibrated()` was a reasonable interim choice when it was written but is now measurably
backwards (worse coverage for real capital than for an unrelated engine's incidental rows). A real fix
needs a product decision, not just a code change: either (a) commit to B1 (compute + persist the real
taxonomy at commit time, going forward, with an explicit stance on already-open rows), or (b) redefine
what the `persistence`/`entry_geometry` pillars measure for an ALREADY-COMMITTED position specifically
(e.g., thesis-intact-since-entry and price-progress-toward-invalidation/target are both real, already-
available signals — `entry_underlying_px`/`thesis_invalidation_px`/`target_underlying_px` are columns
on `swing_positions` today — but redefining pillar semantics is itself a product decision, not a bug
fix, and needs sign-off before implementation). A smaller, independently-scoped near-term improvement
that does NOT require this decision: stop withholding the WHOLE aggregate + breakdown when only SOME
pillars are uncalibrated — `regime`/`theta_budget` (and `flow_corroboration`, once the accumulation
join above is verified) ARE genuinely computable for many committed rows today (regime via
`attachThesisExplanation`'s existing same-day-dossier join; theta_budget from `dte`, always known for
a live contract) — but that reweighting itself changes the health-score's meaning (fewer real pillars
in the weighted average) and deserves its own small, reviewed PR with its own regression tests, not a
rider on this investigation.

### Blast radius (confirmed, so a follow-up PR doesn't have to re-derive this)

- `computeSwingThesisHealth` has exactly ONE production call site: `adapters.ts`'s
  `terminalPlayFromHorizon` (grepped repo-wide; every other hit is a test file).
- `HorizonDeckSource.setupState`/`entryStatus` for a real committed row trace to exactly ONE root:
  `live-plays.ts`'s `livePlayFromSwingPosition` never setting them. Checked `closed-plays.ts` (the
  CLOSED-lane equivalent) for the same gap: confirmed present there too (grepped for
  `setupState`/`entryStatus`/`signalKinds` — zero hits), so a future fix needs to cover both mappers,
  not just the live one.
- Client-side, `containers.tsx`'s `HorizonDeck` reads `p.setupState`/`p.entryStatus` straight off the
  `HorizonPlay` the API returns — no separate client-side default to account for.
- `banger-lane-merge.ts`'s two hardcodes (lines 86-87, 147-148) are a pre-existing, independent design
  choice for a different engine's rows and are explicitly OUT of scope for this finding — not touched.

### What a follow-up implementation would need to touch (for whoever picks B1 or the pillar-redefinition path)

1. A product decision on which direction (B1 vs. pillar redefinition vs. something better) — operator
   or Largo-mandate owner sign-off, since both are user-facing semantic changes to what "Thesis health"
   means for a live position.
2. If B1: `discovery.ts`'s commit-candidate assembly needs the same grounded read machinery
   `serving-ingest.ts` uses (`SetupStateReads`/`EntryReads`), a schema/`entry_context` shape decision,
   `commit.ts`'s `buildCommitInsert` wired to pin it, `live-plays.ts`'s `livePlayFromSwingPosition`
   wired to read it back, and an explicit stance (documented, not silent) on positions committed before
   the change ships.
3. If pillar redefinition: a new `setupPersistenceScore`/`entryGeometryScore`-equivalent pair scoped to
   ALREADY-COMMITTED rows only (pre-entry rows keep the existing taxonomy), fed from
   `entry_underlying_px`/`thesis_invalidation_px`/`target_underlying_px` + live spot, with its own
   regression tests and its own `thesisHealthUncalibrated` interaction (a redefined pillar changes what
   counts as "uncalibrated" for a committed row).
4. Either way: the `signalKinds` accumulation-join follow-up above, verified independently, and
   `closed-plays.ts`'s equivalent mapper fixed alongside `live-plays.ts` (same gap confirmed in both).
