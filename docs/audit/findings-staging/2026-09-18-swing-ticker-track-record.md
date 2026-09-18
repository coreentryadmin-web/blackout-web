> **kind:** `FINDING`

## Ask Largo swing brief never disclosed a ticker's own prior trade history — FIXED

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Area** | Night Hawk Swings / Ask Largo (`src/lib/swing/play-brief-ticker-history.ts`, new file) |
| **Severity** | P3 (a real, previously-missing dimension of the Largo product contract's "historical context" point — not a crash/incorrect-number bug) |
| **PR** | fix/swing-ticker-track-record |

### Root cause

`archetypeTrackRecordSection` (`play-brief-intel.ts`) already cites "how did trades in THIS
ARCHETYPE do" via `calibration-cache.ts`'s cron-distilled snapshot. But that cache is explicitly
not keyed by ticker — it can never answer "has the desk traded THIS ticker before, and how did it
go." A member reading a brief for, say, a third AAPL swing this quarter had no way to know from
the brief itself that the desk has traded that exact name before — the Largo product contract's
"historical context" point (C10, `docs/audit/LARGO-PRODUCT-CONTRACT.md`) was fully served for the
archetype dimension but completely absent for the ticker dimension.

No existing DB query even answered "prior trades on this exact ticker" —
`fetchSwingPositionsRange` is date-scoped, `fetchSwingPositionChain` is root-scoped, neither
ticker-scoped.

### Evidence

Grep evidence (pre-fix, on `origin/main`, which already includes #5190):
- `calibration-cache.ts`'s own file header: the archetype/sub-lane cache it distills is not keyed
  by ticker, so a brief has no way to attach it to "this play" on a per-ticker basis.
- Repo-wide grep for `priorTicker`/`sameTicker`/`tickerHistory`/`tickerTrackRecord`: zero hits
  outside this new module, verified before writing anything.
- `db.ts` had `fetchSwingPositionsRange` (date-scoped) and `fetchSwingPositionChain`
  (root-scoped) but no ticker-scoped query — grep for `WHERE ticker` in `db.ts` turned up only
  unrelated tables (`gex_regime_events`, `flow_anomaly_near_misses`, etc.) prior to this fix.
- `record.ts`: `selectSwingRecordRootIds`/`buildSwingRecord` confirmed exported and reused
  unmodified (the same root-selection + composite-outcome logic `/record` and
  `closedDeckSourcesFromChains` already use), including `composite.chainResolved`/
  `composite.outcome: "win" | "loss" | "open"` matching the new module's assumptions exactly.

RED→GREEN proof (independently reproduced on a fresh `fix/swing-ticker-track-record` branch off
the actual latest `origin/main`, which already includes #5190's merge):
- Removed the new `play-brief-ticker-history.ts`/`.test.ts` files entirely and reverted the five
  touched files (`db.ts`, `play-brief-context.ts`, `play-brief-intel.ts`, `play-brief-types.ts`,
  plus their test files), kept the new/updated test assertions. `npx tsx
  --experimental-test-module-mocks --test src/lib/swing/play-brief-ticker-history.test.ts
  src/lib/swing/play-brief-intel.test.ts src/lib/swing/play-brief-context.test.ts`: module-not-
  found on the deleted file plus **4 assertion failures** (162/174 counted pass across the
  runnable suites, 4 real failures + cancellations from the missing module) — the expected
  "field/module doesn't exist yet" shape.
- Restored. Re-ran the same three files: **174/174 pass**. Full `src/lib/swing/*.test.ts` sweep:
  **1314/1314 pass**.
- `npx tsc --noEmit -p .` on Node 20: clean.
- Full `npm test` suite (Node 20): result to be appended once the background run completes.

### Blast radius

- `src/lib/db.ts` — new `fetchSwingPositionsByTicker(ticker, limit=200)` query, read-only,
  additive.
- `src/lib/swing/play-brief-ticker-history.ts` (new file) — `loadTickerTrackRecord`, chain-aware
  (collapses a rolled position into one prior trade via `record.ts`'s existing chain-assembly
  logic, never reimplemented), self-excludes the reviewed play's own chain, bounded to 20 chain
  reads per request (`MAX_ROOTS`) to protect against a pathological ticker with hundreds of
  historical rows fanning out into hundreds of DB round trips on a single brief request.
- `src/lib/swing/play-brief-intel.ts` — new `tickerTrackRecordSection`, wired into
  `buildIntelSections` right after `archetypeTrackRecordSection`.
- `src/lib/swing/play-brief-context.ts` — wired `loadTickerTrackRecord` into the existing
  `Promise.all` fan-out, bounded via the same `withBriefSourceTimeout` + best-effort
  `.catch(() => null)` discipline every other context source already uses; a small
  `resolveRootPositionId` helper resolves the reviewed play's own chain root for self-exclusion.
- `src/lib/swing/play-brief-types.ts` — new `tickerTrackRecord?: SwingTickerTrackRecord | null`
  field on `SwingPlayBriefContext`.

No existing consumer needed updating — the new field is purely additive and optional throughout.

### Fix rationale

Additive per the Largo product contract: a new field, a new section, nothing flattened or
replaced. Unlike `archetypeTrackRecordSection`, this is a plain factual count with no statistical
graduation gate (no calibrated score is being compared cross-product here), so the Largo C6
confidence-omission principle that gates the archetype section doesn't apply the same way —
omission here means genuine absence of a resolved prior trade, never withheld-but-existing
evidence. A live per-request read (not a cron-distilled cache like the archetype section) was
chosen deliberately: a single ticker's trade population is small by construction (the platform-
wide closed-chain ledger is only ~30-40 trades per CLAUDE.md's own other measurements), so querying
and chain-assembling one ticker's rows is cheap enough to do per-request, with the existing
best-effort/bounded-timeout discipline protecting the brief from a DB hiccup.

### Verification

- Independent re-verification performed from scratch on a fresh branch off actual latest
  `origin/main` (which already includes #5190's merge), not the originating research round's own
  working-tree state — every claimed pre-existing symbol/function (`selectSwingRecordRootIds`,
  `buildSwingRecord`, `fetchSwingPositionById`, `fetchSwingPositionChain`) independently grep-
  verified to exist with the exact signature/behavior the new code assumes, diff applied cleanly,
  RED/GREEN reproduced independently, tsc clean.
- Full suite result to be appended once the background run completes.
