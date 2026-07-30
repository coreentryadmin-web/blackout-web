# Swing CTO Audit — 2026-07-29

Deep audit of Night Hawk Swing (2–30 DTE) from discovery → commit → manage → grade → serve.
Companion to `docs/audit/SWING-ENGINE.md`. Live probe: `npm run healthcheck:swing` (AMBER —
empty book / cold graduation; serving + board GREEN).

## Verdict

The engine architecture is sound (calibration-first, persistence-gated, 7-pillar dossiers).
What kept it from being a **best-in-class live swing system** was not missing ideas — it was
**management gates wired to null inputs** and a **desk that ignored the 7-section triage**.

## P0 findings (fixed this branch)

| ID | Issue | Fix |
|---|---|---|
| P0-1 | `contract_occ` always null at commit → `loadOptionMark` never loads → premium_stop / ladder / mark-frozen rolls inert | `occFromChainContract` at commit + `occSymbolFromSwingRow` reconstruct for legacy rows |
| P0-2 | `thesis_invalidation_px` never pinned → structural_stop never fires | `deriveSwingPlanLevels` in ingest → dossier.plan → commit candidate |
| P0-3 | `fadeStaleSwingCandidates` documented but never called | Called each discovery scan (14d cutoff) |

## P1 findings (fixed this branch)

| ID | Issue | Fix |
|---|---|---|
| P1-1 | `sessionsHeld` never passed → time_stop inert | Computed from `committed_at` in active-refresh |
| P1-2 | Flat `intendedDte:14` for all archetypes | Catalyst short-horizon + `ARCHETYPE_INTENDED_DTE` sub-lane realign |
| P1-3 | HorizonDeck flattened committed/watch; ignored sections + meta | Section-ordered rows + factors/regime/setup/thesis wired |
| P1-4 | Persist failure still upgraded phase claim to DONE | Persist returns boolean; failure releases claim |
| P1-5 | FAILED_BREAKDOWN required 2nd signal KIND (structure-only never promotes) | `requiresCorroboration: false` (Tier-0 already volume-filters) |

## Still open (next PRs)

Shipped on `cursor/swing-followups-3d11` (original five + P0 management/serve follow-ons):

| # | Follow-up | Status |
|---|---|---|
| 1 | Feature-vector pin at commit | DONE |
| 2 | `graduatedRungs` → active-refresh | DONE |
| 3 | `readsByTicker` / spots on horizons serve | DONE |
| 4 | Beta provider + IV series fallback | DONE |
| 5 | `railway.swing-*.toml` catalog | DONE |
| 6 | `thesisProgress01` + `volCollapsed` (time_stop / vol_collapse live) | DONE |
| 7 | TRIM latch + scaledAlready from status (EXIT_RUNNER reachable) | DONE |
| 8 | Open-book live sections (MANAGING/SCALING_OUT/EXITING) | DONE |
| 9 | Active-refresh refreshes serving spots mid-session | DONE |

**Still deferred (not blocking live rail):** catalyst/regime/flow/RS edge booleans (need cross-session deltas); calibratedProbability desk surface; EventBridge infra sync for new TOMLs. **Tactical 15-min cadence:** FIXED 2026-07-30 (`*/15` swing-active-refresh schedule).

## Live health (2026-07-29 ~18:00 ET)

```
A CRON        AMBER  empty sections (quiet / persistence building)
B PERSISTENCE AMBER  0 cleared candidates
C SERVING     GREEN  7 sections present, floors provisional
D BOARD       GREEN  SWING lane spliced
E POSITIONS   AMBER  0 open (cold graduation — expected)
F MARKS       AMBER  n/a without positions
G GRADING     GREEN  50 resolved rows (WR cold)
```

Cold book ⇒ nothing graduates ⇒ nothing commits remains the intentional hard rail.
