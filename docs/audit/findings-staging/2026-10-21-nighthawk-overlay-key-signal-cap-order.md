## 2026-10-21 — [FINDING, Night Hawk / Legacy] Edition-outcome overlay overwrote `conviction` to
the already-capped letter *before* calling `capGatePromotedConviction`, so its own stale-detection
guard never fired and a gate-promoted play's `key_signal` kept citing the pre-cap grade — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Area** | Night Hawk Legacy — `applyEditionOutcomeOverlay` (read-time outcome overlay, every `GET /api/market/nighthawk/edition`) |
| **Severity** | P2 — member-visible self-contradiction between the (correctly capped) conviction/tier badges and the (stale) key-signal sentence, on every gate-promoted play, on every edition read |
| **File** | `src/features/nighthawk/lib/edition-outcome-overlay.ts` (`applyEditionOutcomeOverlay`, ~lines 72-77) |
| **4th site** | Same gate-promoted-conviction-cap-leak bug *class* fixed 3 times earlier this session (PR #6483's three call sites, and PR #6487's `tier`-object leak at this same function) — this is a 4th, distinct ordering bug at this same call site, not a duplicate of either prior PR. |

### Symptom (live repro, production, 2026-10-21)

`GET /api/market/nighthawk/edition`, MSTR play:

```json
{
  "ticker": "MSTR",
  "conviction": "B",
  "tier": { "tier": "B", "factors": [{ "label": "Gate-promoted cap", "direction": "down",
    "detail": "Promoted past a failed quality gate — conviction capped at B regardless of the measured score band." }, ...] },
  "key_signal": "BULLISH — flow + positioning · score 52 (A)",
  "gate_promoted": true
}
```

`conviction` and `tier.tier` both correctly read "B" (both prior fixes, #6483/#6487, hold) — but
`key_signal`'s trailing grade token still reads "(A)", directly contradicting the two badges sitting
right next to it in the same payload. IBM and MMM (same edition, not `gate_promoted`) correctly show
matching score/conviction letters, confirming this is specific to the gate-promoted overlay path, not
a general key_signal bug.

### Root cause

`capGatePromotedConviction` (`src/features/nighthawk/lib/publish-gates.ts:424-440`) only rewrites
`key_signal`'s trailing `"(A)"`/`"(A+)"` grade token when its OWN stale-detection guard reads the
play's `conviction` as still `"A"`/`"A+"` — that read is how it decides a cap (and the matching
key_signal rewrite) is actually due:

```ts
export function capGatePromotedConviction(play: PlaybookPlay): PlaybookPlay {
  if (!play.gate_promoted) return play;
  const conv = String(play.conviction ?? "").trim().toUpperCase();
  if (conv === "A+" || conv === "A") {
    const key_signal = ... .replace(/\(A\+?\)$/, "(B)") ...;
    return { ...play, conviction: "B", key_signal };
  }
  return play;
}
```

`applyEditionOutcomeOverlay` called this function AFTER already overwriting `conviction` to the
already-capped letter:

```ts
// BUGGY ORDER
next.tier = cappedTier;
next.conviction = cappedTier.tier;              // e.g. "B" — overwritten FIRST
next = capGatePromotedConviction(next);         // guard reads conviction === "B" → "A"/"A+" check
                                                 // is false → rewrite branch never fires
```

By the time `capGatePromotedConviction` ran, `next.conviction` already read `"B"`, so its
`conv === "A"/"A+"` guard was always false and the rewrite branch could never execute — `key_signal`
kept citing whatever grade token was built into it at publish time (`buildDeterministicThesis`,
`deterministic-edition.ts`, which stamps the trailing grade from the raw/uncapped merit-tier letter,
unaware of `gate_promoted`), forever, on every live read.

### Why this wasn't caught by the 2 prior fixes at this same function

PR #6487's own written account of this exact code (`docs/audit/FINDINGS.md`, quoted here verbatim)
claimed:

> `capGatePromotedConviction(next); // still runs — no-op once conviction is already capped, but
> still rewrites key_signal's trailing grade token`

That claim is false — "no-op once conviction is already capped" and "but still rewrites key_signal"
cannot both be true, because the rewrite branch is gated on the SAME `conviction === "A"/"A+"` check
that "already capped" falsifies. This is the exact kind of stale, unverified claim
`CLAUDE.md`'s Ask Largo mandate warns about ("verify against `main`/the live function, never trust a
prior write-up at face value") — the earlier PR fixed the `tier`-object leak it was built for, but
its own description of the `conviction`/`key_signal` interaction it left untouched was wrong, and
nothing caught it because the existing regression test (`edition-outcome-overlay.test.ts`) asserted
`conviction`/`tier.tier` but never asserted on `key_signal` for a gate-promoted play.

### Fix

Reordered so `capGatePromotedConviction` sees the RAW, pre-cap tier letter (not the already-capped
one) when its guard runs, then re-derives the final `conviction` from the capped tier assignment
afterward (needed for every play this block touches — not just the gate-promoted-and-capped case,
since `capGatePromotedConviction` is a no-op whenever `gate_promoted` is false or the raw tier wasn't
A/A+, and something still has to sync `conviction` to the tier pin in those cases):

```ts
const cappedTier = capGatePromotedTierAssignment(overlay.tier, p.gate_promoted === true);
next.tier = cappedTier;
next.conviction = overlay.tier.tier;            // RAW, pre-cap letter — lets the guard fire
next = capGatePromotedConviction(next);         // now correctly caps + rewrites key_signal
next.conviction = cappedTier.tier;              // re-sync for the non-firing cases too
```

**Fix rationale:** feeding the raw pin letter (`overlay.tier.tier`) rather than relying on
`p.conviction` (whatever the play happened to already carry) makes the fix correct regardless of
what was persisted before this read — the raw tier pin is the one value that actually determines
whether a cap-and-rewrite is due, independent of any prior overlay pass's output. Deliberately left
unchanged: `capGatePromotedTierAssignment`'s own tier-capping logic (correct, from #6487) and
`capGatePromotedConviction`'s own cap/rewrite logic (correct, from #6483) — only the call order
feeding one into the other was wrong.

### Evidence (RED → GREEN, per repo policy)

- **RED:** `git stash push -u -- src/features/nighthawk/lib/edition-outcome-overlay.ts` (source
  only, test file untouched) reverted to the pre-fix call order; the new regression test
  (`applyEditionOutcomeOverlay rewrites a stale (A) key_signal grade trailer for a gate-promoted
  play`) failed exactly as expected:
  ```
  gate-promoted play's key_signal grade trailer must track the capped letter, not the stale pre-cap (A)
  + actual:   'BULLISH — flow + positioning · score 52 (A)'
  - expected: 'BULLISH — flow + positioning · score 52 (B)'
  ```
  The two pre-existing tests in the same file still passed (no behavior regression in the cases they
  cover — this is a strictly narrower gap than those tests check for).
- **GREEN:** `git stash apply` restored the fix; all 3 tests in
  `edition-outcome-overlay.test.ts` pass (`node --experimental-test-module-mocks --test`, Node 20.20.2).
- `npx tsc --noEmit` — clean, no new type errors.

### Blast radius

Only `applyEditionOutcomeOverlay` constructs its `next.conviction` this way before delegating to
`capGatePromotedConviction` — it is the single read-time call site for this overlay (invoked from
`edition/route.ts`'s `withOutcomeOverlay` on every `/api/market/nighthawk/edition` read).
`promoteTopBlocked` (`publish-gates.ts`), the build-time call site, already calls
`capGatePromotedConviction` on a play whose `conviction` has not yet been touched by any cap, so it
was never exposed to this ordering bug. No other caller of `capGatePromotedConviction` or
`capGatePromotedTierAssignment` was found (repo-wide grep).
