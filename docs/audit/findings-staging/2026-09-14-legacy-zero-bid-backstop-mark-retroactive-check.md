> **kind:** FINDING

## Did Legacy's own zero-bid-backstop-mark exposure already corrupt real peak_premium / discord_live_state / closed-position data? Unknown — this sandbox cannot check

| | |
|---|---|
| **Status** | OPEN — reported per the standing escalation policy; the forward-going code fix is separately shipped in PR #4980, this finding is ONLY about whether historical data needs correction |
| **Lane** | Night Hawk Legacy |
| **Severity** | Unknown — could be P1 (real corrupted financial/track-record data + false member notifications, mirroring the confirmed swing/banger incident) or could be zero live impact (if no Legacy contract ever actually hit the bid=0 backstop-quote shape) |
| **Found by** | NIGHT HAWK LEGACY audit lane, 2026-09-14, while root-causing the B_marks staleness finding (PR #4970) led to discovering Legacy's mark-read path shares the swing/banger lane's zero-bid-backstop-mark defect |

### Context — what's already confirmed and already fixed

PR #4980 (this session, same lane) fixed `buildLegacyOptionMarkRow`'s REST-snapshot mark read
going forward: it previously read `snap.mark` directly, the same field the swing/banger lane
found (PR #4969, same session) can be a market-maker "backstop" `bid:0`/ask-only midpoint wildly
divergent from a contract's real last-traded price. Live-reproduced example from that finding:
`CRSR260918C00015000` showed `bid:0, ask:15` → mid `$7.50`, while the real last trade was `$0.07`
(a 107× divergence) — the same shape hit 6 other concurrently-committed BANGER positions the same
session, with **confirmed, persisted corruption**: identical fabricated `peak_premium: 7.5` values
across 5 unrelated tickers, false `TAKE_PARTIAL`/`EXIT_RUNNER` transitions and Discord
notifications, and closed positions with fabricated `realized_pnl_pct` (see
`docs/audit/findings-staging/2026-09-14-banger-fabricated-mark-corrupted-real-scale-out-decisions.md`,
PR #4972, for the full swing/banger-side incident).

**PR #4980 stops the same class of bug from happening in Legacy going forward.** It does NOT
determine whether it already has.

### The open question this finding raises

`legacy-live-sync.ts`'s live-management loop carries the exact same monotonic-ratchet shape the
banger incident exploited:

```ts
const peak = row.peak_premium ?? row.entry_premium;
const peakOut = Math.max(peak, mark);   // can only increase, never decrease
```

If any live Legacy contract's REST snapshot ever returned a `bid:0` backstop quote (plausible for
any less-liquid Legacy pick — Legacy is not restricted to only the most liquid mega-caps the way
this session's currently-open plays, HPE/DELL, happen to be), the resulting inflated `mark` would
have been permanently latched into `peak_premium` via this ratchet, and could have:

1. Fired a false `TRIM` (Legacy's `deriveLegacyPlanAction`: `mark >= premiumTargetPrice(entry)`)
   or a false scale-out `TAKE_PARTIAL`/`EXIT_RUNNER` transition (`deriveScaleOutAction`, shared
   with banger) — sending a real Discord notification to members claiming a profitable exit that
   the real market never supported.
2. Closed a position (`status`/`closedReason`) based on a fabricated retrace-from-peak trigger,
   even if the real underlying contract was still tradeable.
3. Persisted a corrupted `realized_pnl_pct`/`mark` into `nighthawk_play_outcomes`'
   `discord_live_state`, corrupting any win-rate/track-record statistic computed from it —
   including the audit toolkit's own `legacy-e2e-healthcheck.mjs` B_marks stage and this lane's
   own outcome-honesty forensics, neither of which were built to detect THIS specific failure
   mode (a plausible-looking, sub-hundred-dollar, correctly-bounded mark that is nonetheless
   fabricated relative to the real market — not a NaN, not a sign flip, not out-of-band vs bid/ask,
   since the backstop mid VALIDLY sits inside its own [bid, ask] by construction).

### Why this cannot be verified from this sandbox

Per the standing environment notes (CLAUDE.md, "Access reality" §3), **raw Postgres is blocked
here** — only HTTP(S) through the agent proxy works. Verifying this needs either:
- Direct DB access (`nighthawk_play_outcomes.discord_live_state` history, or an audit log of
  every mark this table's ratchet ever saw) that only an ECS exec session or AWS creds with a
  purpose-built query could provide, or
- A new admin export route (mirroring how the banger incident's own finding named the same gap:
  *"Raw Postgres is blocked here... needs either direct DB access or a purpose-built admin export
  route — neither available from this sandbox"*).

I checked what IS reachable from here: the two currently-open Legacy plays (HPE, DELL — both
liquid, actively-quoted large-caps) show sane, tightly-bounded marks with no sign of the `$7.50`-
style fabricated-backstop signature this session (repeated `npm run healthcheck:legacy` pulls,
2026-09-14). That is reassuring for TODAY's specific picks but proves nothing about the roughly
five months of prior Legacy history this lane's journal covers, nor about any less-liquid ticker
Legacy has picked in the past (the banger incident's victims — CRSR/BW/EBS/CPRI/PAGS/BAND/ACVA —
were smaller/thinner names than HPE/DELL, exactly the profile more likely to produce a zero-bid
backstop quote).

### What this finding is asking for

Not a code change — the forward-fix is already shipped (PR #4980). This is asking for the same
thing the banger-side finding asked for and that this lane cannot do itself:

1. A DB-level (or purpose-built admin export) sweep of `nighthawk_play_outcomes` for any row whose
   `discord_live_state.peak_premium` (or historical mark trace, if one exists) shows a value
   implausible relative to the contract's real Polygon-quoted trading range — the same signature
   the banger incident used to find its 5 confirmed rows (multiple unrelated tickers sharing one
   suspiciously round `peak_premium`, or any `peak_premium` that never traded in the contract's
   real history).
2. If any such row is found: the same remediation question the banger finding raised (recompute
   against the real trade history, or flag/null with an honest "corrected" marker) — a
   product/business decision given real member-facing notifications may already have fired, not a
   small/unambiguous CARVE-OUT fix.
3. Confirm whether `LEGACY_DISCORD_ALERTS` has actually been enabled in production during the
   period in question — if it was off, `legacy-live-sync.ts`'s live-management loop never ran at
   all and this entire finding is moot for the live-sync path (though the `/legacy-marks` display
   endpoint itself is unconditional and would still have shown a fabricated live P&L to any member
   viewing the board, independent of the alerts flag).

### Files involved

- `src/features/nighthawk/lib/legacy-option-mark-row.ts` — fixed going forward, PR #4980.
- `src/features/nighthawk/lib/legacy-live-sync.ts` — the `Math.max` peak-premium ratchet and the
  `deriveLegacyPlanAction`/`handleScaleOutAction` decision logic that would have consumed any
  fabricated mark.
- `nighthawk_play_outcomes.discord_live_state` (DB) — where a corrupted `peak_premium` would live.
