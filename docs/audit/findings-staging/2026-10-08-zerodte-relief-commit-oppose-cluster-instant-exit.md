## 2026-10-08 — [FINDING, zerodte] A net-negative-relief 0DTE commit gets instantly reversed by the exit engine's oppose-cluster check, defeating the relief it was just granted — FIXED

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P2 (a shipped relief feature is structurally self-defeating for most of the population it exists to help — not a wrong-number display bug, but a real-money mechanism that round-trips flat/small-loss instead of giving the relieved thesis any chance to play out) |
| **Component** | `src/lib/zerodte/exit-engine.ts` (`detectThesisBreak`'s oppose_cluster arm), consumed by `evaluateExitState` via `exit-sync.ts` |
| **PR** | fix/relief-commit-oppose-cluster-instant-exit |
| **Found via** | 5-engine live monitor, Night Hawk 0DTE health check (`GET /api/market/zerodte/board`'s `ledger`) — inspecting today's committed rows' `cortex` blob and `first_flagged_at`/`exit_at` gap for coherence, not a scripted probe. |

### Root cause

`applyCortexCommitRelief` (`cortex-vector-relief.ts`) lets a gate-surviving 0DTE setup commit
despite a **net-negative** Cortex composite when regime/vector alignment argues the tape overrides
it (`vectorExemptsCortexBlocks` / `regimeExemptsCortexBreakoutRelief` / `regimeExemptsCortexNetNegative`
— both doc comments explicitly promise "full Cortex relief (gex veto strip **+ net-negative
pass**)"). A row reaching the ledger with a negative `entry_context.cortex.score` can therefore
**only** exist because of this relief — `cortex-gate.ts`'s `assessCortexVerdict` always returns
`NET_NEGATIVE` (blocked) for a genuinely negative score otherwise (`if (verdict.score < 0) return
{ decision: "NET_NEGATIVE", ... }`).

The exit-time thesis check (`exit-sync.ts` → `detectThesisBreak`) has TWO arms: a hard **veto**
check, and a softer **oppose_cluster** check (≥2 opposing evidence items whose combined weight
exceeds `Math.max(entryCortexScore, thesis_min_oppose_weight)`). The 2026-09-09 SHOP/MSTR fix gave
only the veto arm a grace period (`skipGexWallsVeto`/`entryGexWallsVetoRelieved`) so the exit check
doesn't immediately re-veto on the exact wall fact relief overrode. It never touched the
oppose_cluster arm. For any relief commit, `entryCortexScore` is negative, so
`Math.max(negative, 0.5)` collapses to the bare `thesis_min_oppose_weight` noise floor — the
**weakest possible margin**, identical to "entry score unknown." The very next exit-sync tick
recomposes nearly-identical fresh Cortex evidence (seconds later, negligible decay), so the SAME
opposing items that made the entry score negative in the first place almost always clear that
floor again immediately — closing the position before the regime/vector thesis the relief was
granted for ever gets a chance to play out.

### Evidence

Live `GET /api/market/zerodte/board` ledger, 2026-10-08 (today's full 7-row committed ledger):

| Ticker | `entry_context.cortex.score` | `gex_walls_veto_relieved` | Flagged → exited | Net P&L |
| --- | --- | --- | --- | --- |
| **WOLF** | **-0.76** | **true** | 16:12:42.000 → 16:12:42.509 (**0.509s**) | 0% |
| **SPY** | **-0.31** | **true** | 14:23:58.000 → 14:24:00.775 (**2.775s**) | -1.33% |
| CIFR | -0.28 | false (regimeNetRelief, no veto to relieve) | 15:25:41 → 15:52:29 (26m48s, flat timeout) | — |
| SPXW | 0.5 | false | ran 34min, exited via ratchet | — |
| QQQ / IONQ / AMD | 0.1 / 0.12 / 0.27 (all non-negative) | false | ran 25-40+min each | — |

Both relief commits with a **negative** entry score closed in under 3 seconds, both via
`exit_reason: "thesis"`. Their exit details prove the gap is not specific to the one source the
2026-09-09 fix targeted:

- **WOLF**: `"Thesis broken (oppose_cluster) at 0% ... 2 opposing readings, combined weight 0.75 >
  entry margin 0.5 — strongest: [vex-charm] net dealer VEX is positive ... fights a short."` — the
  cluster is `gex-walls` (0.36, a regime-mismatch oppose, separate from the wall-crossing veto that
  was stripped) + `vex-charm` (0.4).
- **SPY**: `"Thesis broken (oppose_cluster) at -1.33% ... 2 opposing readings, combined weight 0.7 >
  entry margin 0.5 — strongest: [sector-heat] market breadth is negative ..."` — the cluster here is
  `sector-heat` (0.5) + `opening-harvest` (0.21). **Neither is gex-walls** — SPY's relief was a
  veto-strip on `gex-walls`, but the oppose cluster that killed it is two entirely different
  sources, proving a gex-walls-specific fix (extending the existing `skipGexWallsVeto`) would not
  have caught this case.

Non-relieved commits with a non-negative entry score (SPXW, QQQ, IONQ, AMD) all ran well past the
first tick (25min-40+min) before exiting on their own merits — confirming the instant-exit pattern
is specific to the negative-score-relief population, not a general exit-engine issue.

### Fix rationale

`detectThesisBreak` now short-circuits the oppose_cluster check (returns `null`, same as "no break")
whenever `entryCortexScore < 0` — checked *after* the veto branch, so a genuinely NEW veto from a
different source (not gex-walls) still exits immediately, unaffected. This is deliberately broader
than re-threading `entryGexWallsVetoRelieved` into the oppose_cluster arm (which would only have
fixed WOLF, not SPY — see above): the negative-score signal is proof-by-construction of ANY relief
path (vector, regime-breakout, or regime-net-negative), so it correctly covers all three without
needing a new flag threaded through every call site. A relief commit's own entry decision already
knew this evidence was net-negative and explicitly chose to override it on other grounds; re-testing
the identical Cortex evidence moments later via a different threshold rule contradicts that choice
rather than adding information. The play keeps every other protection — plan stop, ratchet/trim
floors, flat-timeout — only the one check that structurally cannot distinguish "new information"
from "the same reason relief already overrode" is skipped, and only for rows proven to have gone
through relief.

**Left unchanged deliberately:** the veto arm's existing `skipGexWallsVeto` grace (still needed for
the narrower, still-possible case of a genuinely NEW gex-walls veto appearing after entry); the
non-negative-score margin formula (`Math.max(score, floor)` for ordinary commits is untouched — a
dedicated regression test asserts a clean, non-relieved commit still breaks on the identical oppose
pair with a positive entry score, so this fix cannot be read as silently disabling oppose_cluster
generally).

**Blast radius:** `detectThesisBreak` is called from exactly two sites in `exit-engine.ts`
(`decideTrimScale` and the ratchet-mode `evaluateExitState` path), both already passing
`entryCortexScore` straight through from `exit-sync.ts`'s `entryCortexScoreOf` — no caller changes
needed; the fix is entirely inside the shared pure function both paths already route through.

### Evidence that the fix is real (RED → GREEN)

Added two tests to `src/lib/zerodte/exit-engine.test.ts`:
1. `detectThesisBreak`-level: a negative entry score (-0.31) with a SPY-shaped two-source oppose
   cluster (sector-heat + opening-harvest, no gex-walls) must return `null`; the SAME cluster with a
   positive entry score (0.1) must still break — proving the fix is scoped to negative scores only.
2. `evaluateExitState`-level: a WOLF-shaped oppose cluster (gex-walls + vex-charm) with
   `entryCortexScore: 0.1` still exits (`thesis_break:vex-charm`); the identical cluster with
   `entryCortexScore: -0.76, entryGexWallsVetoRelieved: true` does not exit.

Pre-fix (`git stash` on `exit-engine.ts` alone, test file kept): **97 pass / 2 fail** — both new
tests fail exactly as predicted (expected no break, got `oppose_cluster`/`thesis_break:vex-charm`).
Restoring the fix: **99/99 pass**. `src/lib/zerodte/exit-sync.test.ts` (17 tests): 17/17 pass, no
regressions. `npx tsc --noEmit`: clean. Full `npm test` run in progress at write time.
