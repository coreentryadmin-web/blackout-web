> **kind:** FINDING

## Night Hawk Legacy: read-time outcome overlay re-inflates a gate-promoted play's `tier` object — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 — member-facing self-contradiction on live Legacy edition reads |
| **Found** | 2026-10-21, 5-engine live-monitor cycle, Ask Largo standing mandate (live repro: MSTR, `GET /api/market/nighthawk/edition`) |
| **Fixed in** | `src/features/nighthawk/lib/edition-outcome-overlay.ts` |

### Root cause

PR #6483 (merged earlier the same day) fixed three sites where a gate-promoted (mechanically
rescued past a failed quality gate) play's merit `tier` assignment could leak an uncapped "A"/"A+"
next to its correctly-capped `conviction: "B"` badge. It introduced
`capGatePromotedTierAssignment()` (`nighthawk-tiers.ts`) as the shared cap for a full
`NighthawkTierAssignment` object, and wired it into `publish-context.ts`'s build-time pin.

A fourth site was missed: `edition-outcome-overlay.ts`'s `applyEditionOutcomeOverlay()`, which runs
on **every** `GET /api/market/nighthawk/edition` read (not just at build time). It reads the
raw, DB-pinned `publish_context.tier` back via `overlay.tier` and does:

```ts
next.tier = overlay.tier;              // raw pinned tier -- e.g. { tier: "A", factors: [...] }
next.conviction = overlay.tier.tier;   // "A"
next = capGatePromotedConviction(next); // caps conviction + key_signal's trailing grade token only
```

`capGatePromotedConviction` (`publish-gates.ts`) only ever touches `conviction` and
`key_signal` — it never touches the `tier` assignment object. So a gate-promoted play correctly
showed `conviction: "B"` right next to `tier: { tier: "A", factors: [...] }` (uncapped) on every
live read — the exact self-contradiction `capGatePromotedTierAssignment` exists to prevent,
reopened one layer up because this read-time overlay independently re-derives `tier` from the raw
pin instead of trusting (or re-deriving from) the build-time cap.

### Live repro (MSTR, before fix)

`GET /api/market/nighthawk/edition` (edition `published_at: 2026-10-20T21:40:24Z`, i.e. built
*before* #6483 deployed):

```json
{
  "ticker": "MSTR",
  "conviction": "B",
  "tier": { "tier": "A", "factors": [{ "label": "Prime score band", ... }, { "label": "Strong signal breadth", ... }] },
  "key_signal": "BULLISH — flow + positioning · score 52 (B)",
  "gate_promoted": true
}
```

`conviction` and `key_signal` are correctly capped (via #6483's earlier fixes); `tier.tier` is
still the raw, uncapped "A" — the overlay never ran it through `capGatePromotedTierAssignment`.

Note: because #6483's `publish-context.ts` fix now caps `tier` at build time, a **freshly-built**
edition's pinned `publish_context.tier` will already read "B" for a gate-promoted play going
forward — so this specific MSTR row self-resolves once tonight's edition regenerates. The fix in
this PR is still necessary: without it, the overlay blindly trusts whatever `tier` the pin carries
with no cap of its own, so any stale/historical pinned row (pre-fix data, a pin-failure fallback,
a backfill) re-inflates on read exactly as before — the same defense-in-depth gap
`capGatePromotedConviction`'s read-time re-check already closes for `conviction`.

### Fix

`applyEditionOutcomeOverlay` now runs the pinned tier through `capGatePromotedTierAssignment`
(keyed on the play's own `gate_promoted` flag) before assigning `next.tier`, mirroring the exact
pattern `publish-context.ts` already uses at build time:

```ts
const cappedTier = capGatePromotedTierAssignment(overlay.tier, p.gate_promoted === true);
next.tier = cappedTier;
next.conviction = cappedTier.tier;
next = capGatePromotedConviction(next); // still runs — no-op once conviction is already capped,
                                         // but still rewrites key_signal's trailing grade token
```

This makes the overlay itself fail-closed on `tier`, the same way it was already fail-closed on
`conviction` — regardless of what the underlying pin says, a gate-promoted play's displayed tier
can never show higher than "B" on a live read.

### Evidence

- RED: extended the existing `edition-outcome-overlay.test.ts` regression test (added 2026-09-16
  for the sibling `conviction` re-inflation bug) with an assertion that `play.tier?.tier === "B"`
  and carries the "Gate-promoted cap" disclosure factor — failed (`'A' !== 'B'`) before the fix.
- GREEN: same test passes after the fix; full `edition-outcome-overlay.test.ts` +
  `publish-context.test.ts` + `publish-gates.test.ts` + `nighthawk-tiers.test.ts` +
  `claude-edition.test.ts` (88 tests) all pass.
- `npx tsc --noEmit -p .` clean.

### Blast radius

Only this one function re-derives `tier` from a DB pin at read time; `publish-context.ts` (build
time), `claude-edition.ts`'s rescue path, and `publish-gates.ts`'s `key_signal` rewrite were already
covered by #6483. No other call site reads `publish_context.tier` back into a member-facing field.
