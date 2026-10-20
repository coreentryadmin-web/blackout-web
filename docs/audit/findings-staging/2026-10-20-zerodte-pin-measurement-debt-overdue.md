## PIN single-snapshot measurement debt is overdue, not merely open — two ready-to-run tools idle 5-11 weeks

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | REPORTED, NOT FIXED — in the zerodte owned lane, flagging staleness for that lane to act on |
| **Severity** | P3 (two deliberate design decisions each name a specific measurement as the thing that would justify revisiting them, and neither measurement has ever run) |
| **Surface** | `docs/audit/INTENTIONAL-DESIGN.md` items #3 and #10; `scripts/audit/wall-temporal-stability.mjs`, `scripts/audit/gex-wall-snapshot-poll.mjs`, `scripts/audit/zerodte-pin-gate-compound-funnel.mjs`-style tooling |

### What this is

DISCOVERY-lane re-verification sweep, checking an old claim against current `main` for genuine
staleness rather than trusting the doc at face value. Checked `INTENTIONAL-DESIGN.md` item #3
("PIN 'defended wall' is a single-snapshot structural test") — its own text says the companion
measurement was "built + smoke-tested against prod 2026-08-05, but not yet run across a real RTH
session." **That is still literally true today, but it has sat unrun for ~11 weeks**, not the
"short-term gap" the phrasing implies. `evaluatePinRegime` (`src/lib/zerodte/pin-source.ts`) is
unchanged — still a single-snapshot test, no temporal-stability requirement baked in
(`pin-temporal-stability.ts` exists as a separate, default-OFF path). `scripts/audit/wall-
temporal-stability.mjs` and its data-gathering companion `scripts/audit/gex-wall-snapshot-poll.mjs`
are both fully built and still present. Grepped every `wall-temporal-stability` mention in
`FINDINGS.md` (lines 99815, 104417-104422, 104431, 104646) — the latest (2026-08-05/06) ends with
"Follow-up (concrete, ready to run)" and the exact commands. No later entry anywhere shows this
ever actually executed with real multi-snapshot data.

**Item #10** (PIN gate-compound funnel, last updated 2026-09-17) has the identical shape: n=1
PIN-qualified candidate from one RTH snapshot, explicitly calling for "repeated PIN snapshots
across multiple RTH sessions... to accumulate a PIN sample size large enough" — no re-run in the
month since (confirmed via grep across `FINDINGS.md`/`INTENTIONAL-DESIGN.md`).

### Ruled out as a different kind of staleness

`git log --since=2026-09-17 -- src/lib/zerodte/gates.ts` shows only one commit (#5802,
2026-10-10, removing dead code `isSingleRailWithoutFlow`, zero behavior change per its own
staged-finding writeup) — so item #10's gate-stack numbers are not invalidated by code drift,
only by thin-sample staleness. This is a measurement-debt finding, not a code-regression one.

### Suggested next step (for the zerodte lane)

Both items name the exact same root blocker: nobody has scheduled the live intraday-capture step
(`gex-wall-snapshot-poll.mjs` or equivalent) to actually run across a real RTH session. The earlier
2026-08-05 attempt noted a trigger-based capture was tried and blocked on an approval step. Either
run the capture manually across a real session day, or set up a scheduled trigger that doesn't hit
the same approval block, so these two ready-built measurements stop sitting idle indefinitely.
