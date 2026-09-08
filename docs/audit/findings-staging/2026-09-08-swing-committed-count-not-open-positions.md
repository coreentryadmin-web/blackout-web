> **kind:** `FINDING`

## Swing `committed_count` conflated with open positions in Largo's tool payload — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 (member-facing correctness — Largo could answer "how many swing plays are open" wrong) |
| **Surface** | `swingHorizonForLargo` (`src/lib/largo/product-reads.ts`), Largo's `get_swing_horizon` tool |

### Trigger

The operator asked (twice) why only 4 swing plays showed as open on the live board when it
"looked like the engine wasn't working". Per the operator's explicit follow-up instruction
("check the swings UI directly"), I minted a Clerk session, screenshotted
`https://blackouttrades.com/nighthawk?view=swings` via `proxy-browser.cjs`, and confirmed the UI
showed **Open 4 / Watch 26 / Closed 24** while the raw `/api/market/nighthawk/horizons?view=swings`
payload's `committedCount` read **14** (and rising across polls).

### Root cause

`assembleSwingServingLane` (`src/lib/swing/serving-board.ts`) computes
`committed = plays.filter(p => p.status === "COMMIT")`. For the SWING lane, `status === "COMMIT"`
means "score cleared the commit floor" (`serving.ts`'s `aboveFloor` gate) — it is stamped on a play
the moment discovery scores it, **before** any real capital moves. A real ledger position also
carries `status: "COMMIT"` for back-compat (`live-plays.ts` line ~256, explicit comment: *"live
capital is committed — back-compat committed\[\] view"*). So one number silently mixes:
- pre-entry candidates that cleared the floor but haven't (yet, or ever) opened a real position
  (routed to `COMMIT_NOW`/`WAITING_FOR_ENTRY` serving sections), with
- real open `swing_positions` rows (routed to `MANAGING`/`SCALING_OUT`/`EXITING`).

The command-deck UI already resolves this correctly — `horizonDeckStatus()`
(`src/features/nighthawk/command-deck/adapters.ts:758-763`) explicitly downgrades a COMMIT-status
play with no `liveStatus` to `WATCH` for display ("pre-entry actionable, not committed capital"),
which is why the UI's Open count (4) was right all along. **The bug was that Largo's own tool
payload (`compactSwingLane` in `src/lib/largo/product-reads.ts`) forwarded `committed_count:
lane.committedCount` with no disambiguation and no accompanying open-position total** — a member
asking Largo "how many swing plays are open" had a real chance of getting "14" when the true answer
is 4, because the raw field name is a strong (wrong) prior for "open positions", and this was
exactly the same misread I made investigating this from the API before checking the live UI.

This is **not a bug in the swing engine or the commit funnel** — the funnel (score floor → entry
execution → real-time budget/caps/idempotency gates → real position or shadow row, per
`commit.ts`) is working as designed. This finding is scoped narrowly to the Largo tool payload's
missing disambiguation.

### Fix

Added `open_position_count` to `compactSwingLane`'s output — the sum of the lane's own
`section_counts.MANAGING + SCALING_OUT + EXITING` (the three live-position sections), which was
already being computed but never surfaced as a single unambiguous total. Also added
`committed_count_note` explaining what `committed_count` actually measures, so a model reading the
raw payload (not just the section breakdown) cannot mistake it for an open-position count even
without inferring it from `section_counts`.

Blast radius: `compactSwingLane` has exactly one call site (`swingHorizonForLargo`), so no other
consumer is affected. `committedCount`/`watchCount` on the underlying `SwingServingLane` type are
untouched (still used by the command-deck's flat-fallback path per `serving-board.ts`'s own
comment) — this fix only changes what Largo's tool payload adds on top.

### Evidence

- `src/lib/largo/product-reads-swing-open-count.test.ts` (new): mirrors the live incident's numbers
  (14 committed, 4 real open across MANAGING/SCALING_OUT/EXITING) and asserts
  `open_position_count === 4`, distinct from `committed_count === 14`, plus the disambiguating note.
  Proven RED against pre-fix `product-reads.ts` (`expected: 4` assertion failure on
  `open_position_count`, since the field didn't exist), GREEN after.
- Full suite: 13306 pass / 0 fail / 3 skipped (Node 20.20.2). `tsc --noEmit` clean.

### What was deliberately left unchanged

- The commit funnel itself (`commit.ts`'s budget/caps/idempotency gates) — verified working as
  designed, not touched.
- `SwingServingLane.committedCount`/`watchCount` — kept as-is for back-compat consumers; only the
  Largo-facing compact view gained the new field.
- `docs/audit/SWING-SYSTEM.md` already documents this distinction correctly in its Glossary
  ("Floor clear (play status COMMIT)" vs "Open / model ledger") — no doc change needed there, the
  gap was purely in what Largo's own tool payload surfaced.
