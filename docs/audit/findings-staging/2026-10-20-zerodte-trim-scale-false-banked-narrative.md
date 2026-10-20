## 2026-10-20 — [FINDING, P1 Night Hawk 0DTE] trim_scale exit narrative claimed tranches were "already banked" when none ever were — FIXED

> **kind:** FINDING

**Context.** Caught live, in real time, during the standing Night Hawk 0DTE forensic-monitor
cadence: a real position (SLS, committed 2026-10-20 13:06 ET) ran from +52% to a +66.67% peak
while `status=TRIM`, then exited via a Cortex veto thesis-break at +61.46%. Its `exit_detail`
read:

> "Thesis broken (veto) at +61.46% — exiting the remaining position at market, not hoping:
> [gex-walls] ... (had reached a +66.67% peak before the thesis broke) **(2/2 tranches (33%
> each) already banked on the way up.)**"

But the SAME row's own `timeline_tranches` field — the WS-11 post-session trim-leg
reconstruction — was `null`. If two real partial sales had actually executed on the way up,
this row would carry two reconstructed legs. It carries none, because none ever happened: the
entire position was closed in a single sale at the thesis-break instant. The narrative sentence
members read is false.

**Root cause.** `ZERODTE_TRIM_BANK_LIVE` is effectively **off** in production (confirmed this
same day via two independent live signatures — see `docs/audit/0DTE-RESEARCH.md`, "Live
trim_scale tranche-banking never fires in production", and the now-merged PR #6369). While off,
`exit-sync.ts`'s live sync tick recomputes `trimsTaken` fresh every tick as
`trimTranchesArmed(peak, regime)` — **byte-identical to `decideTrimScale`'s own `armed`
variable** — purely so the dead-zone guard inside `decideTrimScale` (exit-engine.ts) keeps
working (a documented, deliberate, tested stand-in: see `resolveTrimBankLive`'s own doc
comment and the 2026-08-27 dead-zone fix). This value was never meant to assert a real bank
happened.

The bug: `decideTrimScale` had no way to tell a REAL persisted `trimsTaken` apart from this
cosmetic recompute. It built its "already banked"/"thirds banked" narrative text straight off
whichever value arrived, with no distinction — so every single exit (floor, thesis-break,
runner-target, or the "running" status report) whose peak had armed a tranche automatically
claimed, in the sentence a member reads, that a real partial close had executed at a better
price. It never had, for any row, the entire time `ZERODTE_TRIM_BANK_LIVE` has been off.

**Blast radius.** Four narrative sites in `decideTrimScale` (exit-engine.ts), all keyed off the
same `taken` count:
1. The floor-exit `detail` ("`This is the runner only — N/2 tranches ... already banked`").
2. The thesis-break `detail` (the exact live SLS shape above).
3. The runner-target exit ("`after both trims — the last third is banked in full`").
4. The RAISE_FLOOR "running" status report ("`N/2 thirds banked ... running the last third`").

Every trim_scale (A/B-tier) position whose peak ever cleared a tranche trigger and then exited
via floor/thesis-break/runner-target — i.e. every trim_scale exit that wasn't a plan-stop or
flat-timeout scratch — carried this false claim. Spot-checked against the same 122-row
population PR #6369 already audited (109 reconstructed + 13 live): the "~18% of the population
that clears a qualifying peak" is exactly the population this bug's narrative affected.

**Fix.** Added `trimsTakenIsGenuine?: boolean` to `ExitEngineInput` (exit-engine.ts) — omitted
defaults to `true` (every existing caller/test that sets `trimsTaken` directly already means it
genuinely, so this is purely additive and backward-compatible). `decideTrimScale` now gates all
four narrative sites on `input.trimsTakenIsGenuine !== false`; when it's explicitly `false`, each
site falls back to honest wording that makes no banking claim (e.g. "exiting the full position
at target" instead of "after both trims — the last third is banked in full"; "no tranche banked"
instead of "N/2 thirds banked"). **The ladder math itself — `armed`, `taken`, the dead-zone
guard, every functional branch condition — is completely unchanged**: this is a narrative-only
fix, by design, since the dead-zone fix this cosmetic `trimsTaken` supports is itself correct and
load-bearing (CLAUDE.md-documented, 2026-08-27). `exit-sync.ts` (the one production call site)
now passes `trimsTakenIsGenuine: deps.trimsTaken != null ? true : trimBankLive` — real only when
the flag is genuinely on, same precedence pattern as its sibling AB-test overrides.

**Why this fix and not an alternative.** Considered zeroing `taken` itself when not live, but
that would corrupt the dead-zone guard's `armed > taken` comparison and reintroduce the exact
2026-08-27 breakeven-dump bug (`SLS`/`TSM` round-tripping to flat because the coarse floor beat
the trim check) — the cosmetic `taken=armed` equality is doing real, necessary work there.
Separating "what the ladder math needs" from "what the narrative may claim" with one new boolean
is the minimal change that fixes the lie without touching the one thing it's deliberately lying
to (functionally) for.

**Tests.** 6 new cases in `exit-engine.test.ts` (RED before the fix, confirmed via
`npx tsx --experimental-test-module-mocks --test` before implementing `trimsTakenIsGenuine`):
the four narrative sites each tested with `trimsTakenIsGenuine: false` suppressing the false
claim without changing `action`/`reason`/`floorPnlPct`, plus a default-omitted backward-compat
test proving every pre-existing genuine-bank narrative is byte-for-byte unchanged. Full
`exit-engine.test.ts` (107/107) and `exit-sync.test.ts` (17/17) pass; `tsc --noEmit` clean;
`npm test` full suite run alongside this PR.

| **Status** | FIXED. No gate, EV, or sizing behavior changed anywhere — this is a pure member-facing-narrative correctness fix. `ZERODTE_TRIM_BANK_LIVE`/`ZERODTE_TRIM_REGIME_LIVE` remain untouched per PR #6369's own recommendation (two rounds of real-cost testing found no reliable edge from flipping either flag). |

Related: `docs/audit/0DTE-RESEARCH.md` "Live trim_scale tranche-banking never fires in
production" (the structural finding this narrative bug is a direct consequence of); PR #6369
(merged, the economic-impact investigation of the same underlying flag state).
