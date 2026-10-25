## 2026-10-25 — [FINDING, P2 Swing Command Deck] G-S14 Cortex gate-block reason mislabels every non-veto outcome as a hard veto — FIXED

> **kind:** FINDING

| | |
|---|---|
| **Status** | FIXED on `fix/swing-g-s14-cortex-nonveto-mislabel` |
| **Found by** | Workflow-fanned Night Hawk Swings board/track-record live audit agent |
| **Scope** | `src/lib/swing/entry-verdict.ts` (`commitGateBlocksForVerdict`) |

### Root cause

`commitGateBlocksForVerdict()`'s G-S14 branch special-cased only `cortex_unavailable`; every other
`gate:G-S14:*` code collapsed to the hardcoded reason `"Cortex preflight vetoed this setup — desk
will not open."` But `cortex-gate.ts`'s own decision table (see its header comment) distinguishes a
genuine Cortex **veto** from four materially weaker, explicitly non-veto block codes:

- `cortex_net_negative` — no veto, the evidence weight itself nets negative
- `cortex_thin_evidence` — no veto, too few sources answered to trust the read
- `cortex_contested` — no veto, real support and real opposition are both present
- `cortex_gex_walls_oppose_unresolved` — no veto, an active dealer-wall oppose wasn't cleared

(plus `cortex_veto_blind`, the fail-closed firewall for when both veto-capable sources fail to
read — a "could not verify either way" outcome, also not a confirmed veto.)

Each of these already carries its own specific, honest reason sentence computed by
`cortexGateBlocks()` (cortex-gate.ts) — but that text is discarded before it ever reaches storage:
`discovery.ts`'s `evaluateSwingCortexForCommit` caller only keeps `pre.blockedBy` (the bare
`gate:G-S14:<code>` tokens), never `pre.reason`. By the time `entry-verdict.ts` renders a
member-facing sentence from the bare code, only the generic "vetoed" fallback was available to it.

### Evidence

Live `GET /api/market/nighthawk/horizons?view=swings` on 2026-10-25: the SOXX WATCH row carried
`commitGateBlockedBy: ['gate:G-S4:regime_degraded', 'gate:G-S6:confluence',
'gate:G-S14:cortex_net_negative']`. `swingEntryVerdict` → `commitGateBlocksForVerdict` feeds
`TerminalPlay.gateBlocks` (`command-deck/adapters.ts:1149`), which `ZeroDteCommandPanel.tsx` —
shared by SWING plays via `commandSinglePanel = horizon === 'ZERO_DTE' || horizon === 'SWING'`
(`PlayTerminal.tsx:253`) — renders verbatim under the member-facing "Why not committed" section. A
member reading SOXX's panel was told Cortex issued a veto, when the real decision was "no veto —
the evidence just nets negative," a materially different and weaker claim. The existing
`entry-verdict.test.ts` coverage (the AMD repro test) only asserted the block's `code` survives,
never the `reason` text, so this mislabeling was never caught.

### Fix

`commitGateBlocksForVerdict`'s G-S14 branch now checks each known block code (`cortex_veto_blind`,
`cortex_veto`, `cortex_net_negative`, `cortex_thin_evidence`, `cortex_gex_walls_oppose_unresolved`,
`cortex_contested`) and gives each its own honest reason, distinct from the genuine-veto sentence.
`code` is left unchanged (`"g_s14_cortex"` for every branch) since nothing downstream keys off a
more granular code yet — only the member-facing reason text changes.

### Fix rationale — why not recompute the real evidence sentence

The real, specific `cortexGateBlocks()` reason (naming opposing sources, the net score, etc.) is
the most precise answer, but recomputing it at display time would need a fresh, expensive Cortex
preflight call — unlike G-S6's confluence recompute two branches above, which is cheap and already
done this way. Persisting `pre.reason` alongside `pre.blockedBy` at the `discovery.ts` call site
would be the more complete fix but is a larger, separate change (a new persisted field, a schema
touch) — this fix closes the immediate, member-facing mislabeling (a wrong CLAIM about what kind of
block fired) without that larger change; the follow-up to persist the real per-instance reason text
is a natural next step, not done here to keep this PR single-issue.

### Blast radius

Only `commitGateBlocksForVerdict`'s G-S14 branch — no other gate branch in this function, no other
caller of this function. Only the Command Deck panel's "Why not committed" rendering changes (what
the exact words say); nothing in commit eligibility, gate evaluation, or storage changes.

### Regression test

`entry-verdict.test.ts`: new test directly exercises `commitGateBlocksForVerdict` with each
non-veto G-S14 code and asserts the reason text never contains "vetoed" for those, while the
genuine `cortex_veto:<source>` code still does. Confirmed RED (reproduces the live SOXX bug —
`cortex_net_negative` rendering "Cortex preflight vetoed this setup") against the pre-fix branch,
GREEN after.
