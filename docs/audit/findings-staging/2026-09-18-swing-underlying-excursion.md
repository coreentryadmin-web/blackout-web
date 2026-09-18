> **kind:** `FINDING`

## Ask Largo swing brief never surfaced underlying excursion since entry — FIXED

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Area** | Night Hawk Swings / Ask Largo (`src/lib/swing/play-brief*.ts`) |
| **Severity** | P3 (absence of real, already-computed signal — not a crash/incorrect-number bug) |
| **PR** | fix/swing-underlying-excursion |

### Root cause

`signedExcursionPct` (`src/lib/swing/manage-sync.ts:225-243`) computes the underlying's own signed,
direction-aware favorable/adverse excursion (%) since entry — derived from the ledger's ratcheted
price extremes + entry + the current tick's spot — on EVERY management tick, for every live swing
position. `manage-sync.ts:389-390` writes the result as dedicated `running_mfe: excursion.mfePct,
running_mae: excursion.maePct,` fields on the `SwingSnapshotInsert` shape — real, permanent columns
on the append-only `swing_position_snapshots` table (`db.ts:2303-2304`: `running_mfe NUMERIC,
running_mae NUMERIC,`), NOT nested inside `event_json`.

`fetchLatestSwingSnapshotEvents` (`db.ts:7974` pre-fix) is the only function that reads the latest
snapshot back out for the serving/brief layer, and its SELECT read only
`position_id, event_json, thesis_state` — `running_mfe`/`running_mae` sit on the exact same row,
right next to `event_json`, and were never selected. So this real, per-tick-computed signal never
reached `manageObservablesFromEvent` (`live-plays.ts:187`), never reached
`livePlayFromSwingPosition`, never reached `TerminalPlay`, and never reached a single Ask Largo brief
for a single open position.

This answers a question genuinely distinct from anything the brief already showed: how far has the
UNDERLYING itself moved in the member's favor or against them since entry, separate from the OPTION
premium peak/P&L already surfaced. A position can sit on modest premium P&L while the underlying
quietly ran hard favorable and gave most of it back (IV crush, theta decay eating the gain), or the
reverse under a volatility expansion — the premium-only view the brief already carries cannot
distinguish these two very different situations.

### Evidence

Grep evidence (pre-fix, on `origin/main`, which already includes #5178/#5180):
- `manage-sync.ts:217-219` (doc comment): "those into the excursion the snapshot's
  running_mfe/running_mae must carry (feature-store.ts's trajectory studies read them as PERCENTS...)"
- `manage-sync.ts:225`: `export function signedExcursionPct(args: {...`
- `manage-sync.ts:389-390`: `running_mfe: excursion.mfePct, running_mae: excursion.maePct,`.
- `db.ts:2303-2304`: `running_mfe NUMERIC, running_mae NUMERIC,` (schema).
- `db.ts:8311/8320-8321`: insert path writing `s.running_mfe ?? null, s.running_mae ?? null,`.
- Pre-fix `fetchLatestSwingSnapshotEvents` SELECT carried only
  `position_id, event_json, thesis_state` — confirmed via the diff's own before/after (the fix's
  SELECT change is the entire root-cause fix).
- Confirmed via grep this field appears nowhere in `src/components`/`src/app` either — only
  consumed by `feature-store.ts`'s offline trajectory studies (`studyTwoStagnantSessions`,
  `studyIvKillsGoodSetups`), never surfaced to a member anywhere.

RED→GREEN proof (independently reproduced on a fresh `fix/swing-underlying-excursion` branch off the
actual latest `origin/main`):
- Reverted the 7 non-test source files, kept the tests. `npx tsx --experimental-test-module-mocks
  --test src/lib/swing/live-plays.test.ts src/lib/swing/play-brief.test.ts`: **3 failures**, all in
  the new tests (`underlyingExcursion` surfacing test, honest-null test, `composeSwingPlayBrief`
  rendering test) — the expected "field doesn't exist yet" shape. Nothing pre-existing broke
  (114/117 pass, the 3 fails are exactly the 3 new tests).
- Reapplied. Re-ran the same two files plus the directly-related sweep (`adapters.test.ts`,
  `db.test.ts`): **301/301 pass**.
- `npx tsc --noEmit -p .` on Node 20: clean.
- Full `npm test` suite (Node 20) against this branch: a first run showed 1 unrelated failure
  (`fetchPolygonTickerDetails: aborting the caller's signal terminates the real underlying
  connection` — a network-timing test with no connection to this diff's files) with no reproducing
  detail captured beyond the single line. An immediate full re-run on the same commit came back
  **14694/14697 pass, 0 fail, 3 skipped**, 100% clean — matching CI's own independently-green
  `verify` check on the same SHA. Concluded genuine transient flake, not a real regression.

### Blast radius

Same additive plumbing shape as #5175/#5178/#5180, for a fourth sibling "pinned at commit/every tick,
never surfaced" field — but sourced from a dedicated snapshot-table column rather than a
`feature_vector` JSONB field:
- `src/lib/db.ts` — `fetchLatestSwingSnapshotEvents`'s SELECT extended; `running_mfe`/`running_mae`
  merged into the returned event map only when non-null.
- `src/lib/horizon-plays.ts` — new `underlyingExcursion?: { mfePct: number; maePct: number } | null`
  field on `HorizonPlay`.
- `src/lib/swing/live-plays.ts` — `manageObservablesFromEvent` extracts the pair off the event blob,
  honest-null unless BOTH are finite numbers (never a half-populated excursion); threaded through
  `livePlayFromSwingPosition`.
- `src/features/nighthawk/command-deck/types.ts` — same field on `TerminalPlay`.
- `src/features/nighthawk/command-deck/adapters.ts` — added to `HorizonDeckSource`, wired into
  `terminalPlayFromHorizon` (OPEN path only). Deliberately NOT added to `SwingClosedDeckSource`/
  `terminalPlayFromClosedSwing` — a closed chain has no ongoing management tick, so a closed position
  honestly has no live excursion read.
- `src/lib/swing/play-brief-resolve.ts` — threaded through `horizonRowToDeckSource`.
- `src/lib/swing/play-brief.ts` — `managementSection` renders the new "Underlying excursion since
  entry" line only when `underlyingExcursion` is non-null.

No other consumer of `HorizonPlay`/`TerminalPlay` needs updating — the field is purely additive and
optional, OPEN-only by design.

### Fix rationale

Additive per the Largo product contract: a new optional field, nothing flattened or replaced, no
fabricated confidence score. Honest-null discipline applied strictly — the helper requires BOTH
`mfePct` and `maePct` to be finite numbers before surfacing either, since a half-populated excursion
(only one side known) would misrepresent the underlying's actual round-trip. OPEN-only scoping is a
deliberate, disclosed boundary (a closed chain's management history has already ended, so there is no
"since entry, ongoing" read to show) rather than a silent gap.

### Verification

- Independent re-verification performed from scratch on a fresh branch off actual latest
  `origin/main` (which already includes #5178/#5180), not the originating research agent's own
  working-tree state — diff applied cleanly, RED/GREEN reproduced independently, tsc clean.
- Full suite result to be appended once the background run completes.
