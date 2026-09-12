> **kind:** FINDING

# `docs/audit/INTENTIONAL-DESIGN.md` item #2 described the Cortex veto as stateless for 20 days after a dwell/hysteresis latch shipped — DOC CORRECTED, no code change

| Field | Detail |
|---|---|
| **Status** | FIXED (documentation only — no production behavior changed) |
| **Lane** | Night Hawk 0DTE / audit-tooling hygiene |
| **Severity** | P3 — no live-trading impact (the code was already correct and already shipped); the risk is a future reader (human or agent) trusting a design doc that actively described the wrong live behavior and either (a) re-litigating a "no hysteresis" design question that was already settled, or (b) misreading a fresh `veto-flicker-rate.mjs` run as measuring the original pre-dwell question when it no longer can |
| **Files** | `docs/audit/INTENTIONAL-DESIGN.md` (item #2), `scripts/audit/veto-flicker-rate.mjs` (header comment), `CLAUDE.md` (audit toolkit entry for `veto-flicker-rate.mjs`) |
| **PR** | (opened same session as this finding, branch `fix/intentional-design-cortex-veto-dwell-drift`) |

## Task context

Investigated per a queued fix-wave task ("cortex-veto-dwell-doc-drift") that had never actually
started (a sandbox worktree-creation error aborted it before any investigation) — this session
started fresh and independently verified the hypothesis rather than assuming it was correct.

## Root cause

`docs/audit/INTENTIONAL-DESIGN.md` item #2, "Cortex veto has no hysteresis / latching (recomputed
each pass)," stated as current fact that `evaluateCortexForCommit`/`assessCortexVerdict`
(`src/lib/zerodte/cortex-gate.ts`) compose a fresh verdict every pass with "no memory of prior
passes," and that this was a deliberate, unrevisited design choice. Its most recent evidence was a
2026-08-05 `veto-flicker-rate.mjs` run concluding "insufficient/confounded evidence —
`cortex-gate.ts` NOT touched," with a note to re-run once more post-throttle-fix sessions
accumulated.

**That description stopped being true of the live system on 2026-08-25.** PR #2904 ("thesis
follow-ups — G1 sync, G2 rank cal, G5 cortex dwell, Helix/DP") shipped
`src/lib/zerodte/cortex-veto-dwell.ts`: a Redis-backed dwell/hysteresis latch
(`applyCortexVetoDwell`/`applyCortexVetoDwellPure`) that, once a Cortex veto fires for a ticker,
holds that VETO verdict across subsequent scan passes until `ZERODTE_CORTEX_VETO_DWELL_PASSES`
(default **3**) consecutive non-veto passes have been observed (`0`/`off`/`false` disables it). This
is wired **unconditionally** into `scan.ts`'s `attachGateVerdicts` — the single commit path both the
legacy and thesis-first setups share — immediately after `evaluateCortexForCommit`:

```ts
s.cortex = await evaluateCortexForCommit(s.ticker, s.direction, new Date(nowMs), {}, {
  failClosedOnVetoBlind: true,
});
s.cortex = await applyCortexVetoDwell(today, s.ticker, s.cortex);   // <-- shipped 2026-08-25, PR #2904
s.cortex = applyCortexCommitRelief(...);
```

This is exactly the "once vetoed, stay vetoed for N passes" mechanism INTENTIONAL-DESIGN.md item #2
said the system deliberately did **not** have. `docs/audit/FINDINGS.md`'s own dated entry for PR #2904
("Thesis-first follow-ups phase 2 — G1/G2/G5 + Helix/dark pool") already correctly records G5 as
shipped and unconditional in scope — the drift is specifically that `INTENTIONAL-DESIGN.md` (the
file this repo's own standing note says to "keep updated as the measurements run and any of these
decisions is revisited") was never touched to match, and neither was the measurement script's own
header comment, which independently asserted the same now-stale "stateless" claim as established
fact rather than history.

## Why the dwell shipped without INTENTIONAL-DESIGN item #2's own evidence bar being cleared

`docs/audit/THESIS-FIRST-DESIGN-REVIEW.md`, a review draft git-logged ~1 hour before PR #2904's
commit on the same day (2026-08-25), independently named this exact behavior as its own gap: **"G5 —
Cortex veto is stateless: veto recomputed every pass, no hysteresis → flicker risk."** PR #2904's
commit message labels the fix "G5 cortex dwell" — the SAME G5 label, but that review's own ad-hoc
gap numbering (G1-G9), not the unrelated hard-gate stack's `G-5` (`governor.ts`'s session governor,
referenced throughout `board.ts`/`gates.ts`) — worth flagging explicitly since the shared label could
otherwise confuse a future reader cross-referencing FINDINGS.md against the gate stack.

No second `veto-flicker-rate.mjs` run happened between the 2026-08-05 "insufficient evidence" result
and the 2026-08-25 ship date. The dwell was added on architecture-review judgment (a real, named
design gap from an independent review) rather than on a fresh measurement clearing the "only a high
flicker rate is evidence for adding a dwell" bar INTENTIONAL-DESIGN.md item #2 itself set. That is a
legitimate way to ship a change — but it is a different justification than "evidence-driven," and the
doc should not have kept implying the latter applied by simply never mentioning the change happened.

## Fix (documentation only)

- `docs/audit/INTENTIONAL-DESIGN.md` item #2 rewritten in the file's own established
  "REVISITED"/correction pattern (matching items #1 and #4): keeps the original "Prior choice" and
  "First real run — 2026-08-05" history verbatim (it remains accurate as history), adds a
  "Shipped choice (2026-08-25)" section describing the actual mechanism/defaults/wiring, explains why
  it shipped without a fresh measurement, and corrects the re-run guidance — a post-2026-08-25 run
  now measures "does the dwell reduce observed flicker," not the original pre-dwell question, because
  the pre-dwell system no longer runs in production.
- `scripts/audit/veto-flicker-rate.mjs`'s header comment corrected to describe the dwell and what a
  run against post-2026-08-25 data actually measures, so a future reader of the script itself (not
  just the design doc) isn't misled the same way.
- `CLAUDE.md`'s one-line audit-toolkit entry for `veto-flicker-rate.mjs` updated to stop asserting
  "the stateless veto" as current fact and point to the corrected INTENTIONAL-DESIGN.md section.

## Evidence

- `git log --follow --diff-filter=A -- src/lib/zerodte/cortex-veto-dwell.ts` → single commit
  `a3c231359` ("feat(zerodte): thesis follow-ups — G1 sync, G2 rank cal, G5 cortex dwell, Helix/DP
  (#2904)"), authored 2026-08-25 13:11:02 -0700.
- `scan.ts:1253` — `s.cortex = await applyCortexVetoDwell(today, s.ticker, s.cortex);` — confirmed
  unconditional (no `ZERODTE_THESIS_FIRST` gate around this line) inside `attachGateVerdicts`.
- `docs/audit/FINDINGS.md` "Thesis-first follow-ups phase 2" entry (dated 2026-08-25) — already
  records G5 correctly; not itself edited (FINDINGS.md is an append-only historical log, correctly
  dated, not the "living" doc this drift concerns).
- `docs/audit/THESIS-FIRST-DESIGN-REVIEW.md` — git-log modified 2026-08-25 12:17:22 -0700 (54 minutes
  before the fix commit), names "G5 — Cortex veto is stateless" as an open gap; left unedited here as
  a point-in-time review snapshot, not a living doc the standing policy requires keeping current.
- `grep -rn "dwell\|hysteresis" docs/audit/0DTE-RESEARCH.md docs/audit/MARKET-OPEN-VALIDATION.md
  docs/audit/RUN-LOG.md` — zero hits in all three; no stale claim found there to correct.
- No `veto-flicker-rate.mjs` run has been logged (RUN-LOG.md, FINDINGS.md, or
  INTENTIONAL-DESIGN.md itself) since 2026-08-05 — the "re-run" note this fix removes was itself
  overdue by 5+ weeks and, worse, no longer answers the question it was written to answer (see
  above), so it was corrected rather than just re-run as-is.

## Blast radius

Documentation and one code-comment only. No file under `src/` that affects runtime behavior was
touched; `cortex-gate.ts`, `cortex-veto-dwell.ts`, and `scan.ts` are unchanged. Verified no other doc
(`0DTE-RESEARCH.md`, `MARKET-OPEN-VALIDATION.md`, `RUN-LOG.md`, `NIGHTHAWK-MAP.md`,
`NIGHTHAWK-CERTIFICATION.md`, `0DTE-UNIFICATION-DESIGN.md`) makes a "stateless veto" claim that
needed the same correction — only `INTENTIONAL-DESIGN.md`, the measurement script's own header, and
CLAUDE.md's one-line pointer to it did.

## Fix rationale — why documentation-only, not a gate change

The task framing offered three options: fix docs (pure drift), change the gate (if evidence
justified it), or write up an open question. This is squarely the first: the code is already
correct, already tested (`cortex-veto-dwell.test.ts`, 2 tests, part of the 28/28 "thesis follow-up"
suite cited in the original PR), and already live for ~2.5 weeks with no reported regression. Nothing
here justifies touching a live 0DTE gate a second time on top of an already-shipped, already-reviewed
change — doing so would be scope creep against a finding that is purely about documentation
accuracy. The one live-data question this drift surfaces (does the shipped dwell actually reduce
observed flicker, now that it's been running for weeks) is named as the honest next step in the
corrected doc text rather than attempted here, consistent with this repo's "don't force a
measurement that isn't cheap just to close a finding" discipline — it needs a live
`zerodte_scan_rejections`/`zerodte_discovery_events` export this sandbox does not have queued, not a
doc edit.

## Regression test

None added — no code or runtime behavior changed, per the repo's own established pattern for
doc-only corrections (e.g. the 2026-08-06 `BREAKOUT_MAX_CANDIDATES` text correction in
`INTENTIONAL-DESIGN.md` §4 / `CLAUDE.md`, also shipped without a new test). `tsc --noEmit` and
`npm test` run clean (see PR) to confirm the one touched `.mjs` script's comment edit didn't break
its own syntax.
