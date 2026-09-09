# G-23 qualification-to-commit dislocation — built PURELY as the fast+large move check

> **kind:** FINDING

## Context

The operator-approved CTO gate-architecture review named G-23 (`qualification_dislocation`)
as an existing gate that "currently blocks on EITHER (a) fast+large underlying move since
qualification OR (b) a crossed/locked quote at commit time" and asked for (b) to be removed
since it duplicates G-9. **Verified against `main` directly**: no G-23 / `qualification_dislocation`
/ any crossed-or-locked-at-commit check exists anywhere in `src/lib/zerodte` — it was not
shipped by an earlier PR today as the review's own text allowed for. This PR therefore BUILDS
G-23 fresh, correctly scoped from the start: PURELY the fast+large underlying-move check, no
crossed/locked branch ever added (that duplication the review wanted removed simply never gets
introduced).

## What it does

`qualificationDislocationGateBlocks` (gates.ts) compares the underlying's price at the moment a
setup first QUALIFIED as a candidate against its price at COMMIT time. If the move is BOTH large
(> 0.75%, absolute) AND fast (within 5 minutes), the setup fails closed with the new
`qualification_dislocation` code — real information (a real, fast dislocation) the setup's
original geometry (score, confluence, otm_pct) never priced in. A large move that happened
SLOWLY (drift over a session) does not block; a fast move that is too small does not block. It
never inspects a quote at all — the input type doesn't even accept bid/ask — so it structurally
cannot duplicate G-9's own crossed/locked detection (`evaluateQuoteValidity`, plan.ts), which
remains the sole owner of quote-integrity checks.

Fails OPEN on any missing input (mirrors every other optional gate input in this file) and never
manufactures a block from a clock-disordered pair (commit timestamp before qualification —
a caller bug, not a real dislocation). DIRECTIONAL ONLY, mirroring the moneyness re-check's own
CONDOR exemption (a condor has no single-strike geometry to dislocate).

## Wiring (scan.ts)

The ORDINARY (non-thesis-first) pipeline already refreshes `s.underlying_price` to the live
COMMIT-time spot (`attachContractPlans`) BEFORE gates run (`attachGateVerdicts`) — so by
gate-evaluation time the QUALIFICATION-time reading would already be overwritten. Fixed by
snapshotting every setup's `underlying_price`/`underlying_price_as_of` into a
`qualificationByTicker` map immediately BEFORE `attachContractPlans` runs, threaded into
`attachGateVerdicts` as a new (default-empty) parameter — the ordinary pipeline then has both
readings available in the SAME `evaluateZeroDteGates` call, no refresh needed.

The thesis-first pipeline defers `attachContractPlans` until AFTER gates run, so its commit-time
reading is unavailable at first evaluation — `refreshQualificationDislocationGateBlocks` (new,
mirrors `refreshMoneynessGateBlocks` exactly) re-applies the check once that refresh has
actually happened, using the SAME qualification snapshot.

## Evidence

`gates.test.ts`: 13 new tests — the pure function's boundary matrix (fast+large blocks, slow+
large doesn't, fast+small doesn't, exactly-at-threshold doesn't per strict `>`, the crossed/
locked-is-out-of-scope proof, fail-open on every missing field, clock-disorder never
manufactures a block), plus wiring tests through `evaluateZeroDteGates` (fires, absent-fields
no-op, CONDOR exempt) and the deferred-refresh path (`refreshQualificationDislocationGateBlocks`,
including its own CONDOR exemption). Full `src/lib/zerodte/*.test.ts` suite: 1315 pass / 0 fail
on Node 20 (1 pre-existing unrelated skip). `npx tsc --noEmit` clean.

| **Status** | FIXED in `fix/g23-qualification-dislocation-only` |
