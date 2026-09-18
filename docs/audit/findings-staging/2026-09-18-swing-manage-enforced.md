> **kind:** `FINDING`

## Ask Largo swing brief showed un-graduated manage-engine recommendations undistinguished from enforced gates — FIXED

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Area** | Night Hawk Swings / Ask Largo (`src/lib/swing/play-brief*.ts`) |
| **Severity** | P3 (a narrative-fidelity gap — display text overstated confidence, not a crash/incorrect-number bug) |
| **PR** | fix/swing-manage-enforced |

### Root cause

`evaluateSwingManagement` (`src/lib/swing/manage.ts`) computes `verdict.enforced` on every
management tick (manage.ts:290-297): `true` always for the four capital-preservation GATE rungs
(`structural_stop`/`thesis_stop`/`expiry_risk`/`premium_stop`, `GATING_RUNGS` at manage.ts:73-78),
but `false` for every EDGE rung (`catalyst_shift`/`regime_shift`/`flow_decay`/`rel_strength_loss`/
`vol_collapse`/`time_stop`/`add_eligible`) until that specific rung graduates in the PR-16
calibration ladder (`isEnforced()`, manage.ts:222-226: n≥10, delta≥15pt). manage.ts's own header
comment (lines 27-28) states the law explicitly: "preservation rungs GATE (enforced:true always)...
Every EDGE rung is evidence-only (enforced:false) until its name appears in the caller's [graduated
list]."

`manage-sync.ts:397` persists this onto every snapshot's `event_json.enforced`, and
`latchSwingLiveStatus` (manage-sync.ts:91-96) only actually moves the ledger to TRIM when
`verdict.enforced && rung === "profit_ladder"` — i.e. the system genuinely takes no action on an
un-graduated edge-rung signal; that discipline is real and already correctly gates the ledger.

But `live-plays.ts`'s `manageObservablesFromEvent` (the sole reader of that `event_json` for
serving) only ever extracted `action`/`rung`/`thesis_state` — never `enforced`. So `manageAction`
was set to `TAKE_PARTIAL`/`EXIT`/`STOP_OUT`/`ADD` regardless of whether the deciding rung was
enforced, and the brief's Management section rendered "Manage engine: **TAKE_PARTIAL**" with
identical visual weight whether that recommendation was a hard, acted-on capital-preservation gate
or an un-graduated edge-rung signal the system itself is not acting on. Given the closed swing
population's documented small size (CLAUDE.md: ~31-37 trades, most calibration buckets nowhere near
n≥10), most live edge-rung recommendations today are un-graduated/advisory-only — a direct violation
of manage.ts's own calibration-first law: the desk can SHOW a signal long before it's allowed to
act on it, but nothing told the member the showing wasn't the acting.

### Evidence

Grep evidence (pre-fix, on `origin/main`, which already includes #5178/#5180/#5182):
- `manage.ts:27-28` (doc comment): "preservation rungs GATE (enforced:true always)... Every EDGE
  rung is evidence-only (enforced:false) until its name appears in the caller's [graduated list]."
- `manage.ts:73-78`: `GATING_RUNGS` set definition.
- `manage.ts:222-226`: `isEnforced(rung, graduated)` — `GATING_RUNGS.has(rung)` short-circuits true.
- `manage.ts:290-297`: `evaluateSwingManagement` stamps `enforced: isEnforced(rung, ...)`.
- `manage-sync.ts:92-96`: `latchSwingLiveStatus` gates the actual ledger TRIM transition on
  `verdict.enforced && rung === "profit_ladder"`.
- `manage-sync.ts:397`: `enforced: verdict.enforced,` persisted onto the snapshot insert.
- Zero pre-existing hits for `manageEnforced|\.enforced` in `live-plays.ts`, `horizon-plays.ts`,
  the command-deck types/adapters, or `play-brief.ts` prior to this fix, verified by isolating the
  6 non-test source files via `git stash`.

RED→GREEN proof (independently reproduced on a fresh `fix/swing-manage-enforced` branch off the
actual latest `origin/main`):
- Reverted the 6 non-test source files, kept the tests. `npx tsx --experimental-test-module-mocks
  --test src/lib/swing/live-plays.test.ts src/lib/swing/play-brief.test.ts`: **5 failures**, all in
  the new tests (`manageEnforced` surfacing ×4, `composeSwingPlayBrief` advisory-note rendering ×1)
  — the expected "field doesn't exist yet" shape. Nothing pre-existing broke (121/126 pass, exactly
  the 5 new tests fail).
- Reapplied. Re-ran the same two files plus the directly-related sweep (`adapters.test.ts`,
  `horizon-plays.test.ts`, `play-brief-resolve.test.ts`): **300/300 pass**.
- `npx tsc --noEmit -p .` on Node 20: clean.
- Full `npm test` suite (Node 20) against this branch: **14737/14740 pass, 0 fail, 3 skipped**
  (449282ms).

### Blast radius

Same additive plumbing shape as the prior four "pinned/computed, never surfaced" Ask Largo fixes
this session, for a fifth sibling field — this time a tri-state boolean sourced from the management
snapshot's `event_json`:
- `src/lib/swing/live-plays.ts` — `manageObservablesFromEvent` reads `manageEvent.enforced`
  (tri-state true/false/null on absent-or-malformed), force-set `true` inside the three GATE
  override branches (defensive, matches `isEnforced()`); `livePlayFromSwingPosition` threads it
  onto the returned `HorizonPlay`.
- `src/lib/horizon-plays.ts` — new `manageEnforced?: boolean | null` field on `HorizonPlay`.
- `src/lib/swing/play-brief-resolve.ts` — threaded through `horizonRowToDeckSource`.
- `src/features/nighthawk/command-deck/adapters.ts` — `HorizonDeckSource.manageEnforced` +
  `terminalPlayFromHorizon` mapping (OPEN path).
- `src/features/nighthawk/command-deck/types.ts` — same field on `TerminalPlay`.
- `src/lib/swing/play-brief.ts` — `managementSection` appends the advisory-only note only when
  `manageAction !== "HOLD" && manageEnforced === false`; null (no snapshot yet) stays silent.

Deliberately did NOT touch `recommendationFromManageAction` or the wider command-deck SELL/TRIM/BUY
badge — that surface has a broader blast radius across the whole command-deck board, out of scope
for a fix to the Ask Largo brief's own narrative text.

### Fix rationale

Additive per the Largo product contract: a new optional field, nothing flattened or replaced, no
fabricated confidence score. The advisory note only ever ADDS a qualifier to an existing
recommendation the brief already showed — it never suppresses or changes the underlying
`manageAction`/`manageReason` display, consistent with manage.ts's own stated design (calibration
gates ACTING, not SHOWING). Honest-null discipline: absent or malformed `enforced` data renders no
note at all, never a guessed advisory label.

### Verification

- Independent re-verification performed from scratch on a fresh branch off actual latest
  `origin/main` (which already includes #5178/#5180/#5182), not the originating research agent's
  own working-tree state — diff applied cleanly, RED/GREEN reproduced independently, tsc clean.
- Full suite result to be appended once the background run completes.
