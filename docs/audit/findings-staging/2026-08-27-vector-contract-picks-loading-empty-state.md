> **kind:** `FINDING`

## Vector contract-picks card gave no signal between "still loading" and "no picks generated" — FIXED

| **Status** | FIXED |
|---|---|

**Root cause.** `VectorContractPicksCard` returned `null` unconditionally whenever `picks.length === 0`
(`src/features/vector/components/VectorContractPicksCard.tsx`), regardless of the `loading` prop it
already receives. A member looking at a real, directional play with zero picks — every candidate
contract missed `MIN_SHOW_SCORE` or the liquidity/premium gates in `rankVectorPlayCandidates` — saw
exactly the same nothing as a member whose picks were simply still in flight on page load, or a
member on a genuinely neutral-bias ticker where no play (and therefore no picks) is expected at all.
Three distinct states collapsed into one blank space.

**Fix.** The empty branch now distinguishes three cases:
- `loading` → a lightweight "Scanning the chain for a contract worth showing…" card, so a member
  mid-fetch doesn't read the blank space as "there's nothing here."
- not loading, but a real directional play exists (`play.bias !== "neutral"`) with zero picks → an
  explicit "No contract in the chain cleared our setup-quality bar for this play right now" card —
  the honest, member-relevant explanation for the MIN_SHOW_SCORE/liquidity-gate case.
- not loading, no play, or a neutral-bias play → still renders nothing, since there is genuinely no
  play to report on.

**Blast radius.** `VectorContractPicksCard` only — no change to `rankVectorPlayCandidates` or any
ranking/gating logic. This is purely a "say what's actually happening" fix, not a change to which
contracts qualify.

**What was deliberately left unchanged.** The `MIN_SHOW_SCORE` threshold itself, and every OI/premium
liquidity gate — changing those numbers would need the kind of measured evidence (a backtest or A/B
harness) this repo's `docs/audit/INTENTIONAL-DESIGN.md` pattern requires before touching a calibrated
threshold, not a guess made while fixing a UI-visibility gap.

**Verification:** new regression test (`VectorContractPicksCard.test.ts`, source-text assertion
pattern matching this repo's other component tests) guards that the empty-picks branch is a real
conditional (not a bare `return null`), that `loading` is checked, and that a neutral/no-bias play
still renders nothing. `tsc --noEmit` clean, full suite clean (11001 pass / 0 fail / 2 pre-existing
skips), `npm run build` clean.
