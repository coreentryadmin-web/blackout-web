> **kind:** FINDING

## Night Hawk Legacy — morning command-center table, Phase 2F part 2 (safe half) — SHIPPED

| **Status** | SHIPPED (pure composer + 8 unit tests; admin route wiring is a separate, follow-on PR) |

### Root cause / gap

The operator's 2026-09-18 continuous-learning mandate (`legacyContinuousLearningMandate_2026_09_18T0621Z`
in `docs/audit/nighthawk-legacy-live-journal.json`) names two distinct output surfaces under
Phase 2F:

- Item #15, "automatic post-market learning report" — shipped as Phase 2F part 1, PR #5200
  (daily learning digest to ops Discord).
- Item #14, "a compact table (TICKER/DIRECTION/SCORE/ENTRY/STOP/TARGETS/WHY NOW/INVALIDATION),
  not paragraphs, plus WATCHING/REJECTED/MARKET REGIME/SYSTEM CONFIDENCE sections" — the
  **pre-market** command-center view. Grepping all merged/open PR history for "Phase 2F" /
  "command center" / "morning command" found only part 1; part 2 was never started. This PR
  ships it.

### Evidence

Checked the data this table needs already exists, scattered across four places that have never
been assembled together:

- `src/features/nighthawk/lib/types.ts`'s `PlaybookPlay` already carries `ticker`/`direction`/
  `score`/`entry_range`/`target`/`stop`/`key_signal` — everything ACTIVE needs except a direct
  INVALIDATION field (see Fix rationale below).
- `src/features/nighthawk/lib/candidate-leaderboard.ts` (Phase 2D safe half, PR #5187/#5197)
  already classifies every candidate into WATCH/READY/TRIGGERED/ACTIVE/REJECTED with a
  `rejection_reason` on the terminal `rejected` trajectory point — exactly WATCHING/REJECTED.
- `src/features/nighthawk/lib/market-regime.ts` (Phase 2A part 2, PR #5177) already stamps a
  `market_regime` tag onto every `nighthawk_candidate_snapshot` row at edition-build time —
  MARKET REGIME, zero recompute needed.
- `src/app/api/market/nighthawk/record/route.ts` already computes a by-conviction Wilson CI
  (`wilsonLowerBound`/`wilsonUpperBound` from `@/lib/swing/calibration`) on win rate — SYSTEM
  CONFIDENCE, reused as-is.

### Fix / what shipped

`src/features/nighthawk/lib/command-center-table.ts` — a PURE composer, `buildCommandCenterTable`,
taking the four already-fetched-elsewhere inputs above and assembling the operator's exact table
shape. Zero new I/O (same "safe half" discipline as every prior Phase 2 sub-step: 2A/2B/2D/2F part 1
each shipped their pure compute primitive before a route wired it to live data). `ACTIVE`-status
leaderboard entries are excluded from WATCHING/REJECTED to avoid double-listing a ticker already
in `active` (built from `plays`).

`src/features/nighthawk/lib/command-center-table.test.ts` — 8 unit tests: column mapping, the
no-`risk_note`→`invalidation: null` honesty guard, WATCH/READY/TRIGGERED routing, REJECTED
reason extraction off the trajectory's own `rejected` point, ACTIVE-entry de-duplication, regime/
confidence pass-through verbatim, and empty-input safety.

### Fix rationale — what was deliberately left unchanged

- **No admin route in this PR.** Every prior Phase 2 sub-step (2D, 2F part 1) shipped its pure
  primitive first and wired a route in a separate, smaller follow-on PR — same discipline here,
  keeping this PR reviewable and zero-risk (no new fetch, no new DB query, no live behavior
  change at all).
- **INVALIDATION mapped from `risk_note`, disclosed as a proxy, not the real thing.**
  `PlaybookPlay` has no dedicated invalidation field. `risk_note` is the closest existing field
  (a cautionary prose note already shown to members) and reads `null`, never fabricated, when a
  play carries none — the module header states this mapping explicitly so a future session
  doesn't mistake it for an operator-specified field.
- **No change to any gate, score, or publish behavior.** This is read-only composition of data
  the pipeline already produces; it cannot change which plays publish or how many.

### Blast radius

New file only (`command-center-table.ts` + its test) — nothing else imports it yet, so this PR
cannot regress any existing route or page.

### Next step

A follow-on PR wires an admin route (`GET /api/admin/nighthawk/command-center`, consistent with
the existing `candidate-leaderboard`/`direction-failure-diagnosis` admin-route pattern) that
fetches today's edition plays, today's `nighthawk_candidate_snapshot` rows (for both the
leaderboard and the `market_regime` tag), and the `/record` route's by-conviction Wilson CI, then
calls `buildCommandCenterTable`. Not done in this PR, per the safe-half discipline above.
