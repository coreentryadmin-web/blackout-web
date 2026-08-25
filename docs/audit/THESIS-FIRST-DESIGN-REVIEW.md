# Thesis-first 0DTE — design review & improvement roadmap

> **Status:** REVIEW DRAFT (2026-08-25)  
> **Audience:** Claude / human reviewers — architecture, gaps, and next-build priorities  
> **Context:** Phase 2 live (`ZERODTE_THESIS_FIRST=1`), PRs #2897–#2901 merged or in flight  
> **Ask for review:** Is this the best system so far? Are gaps accurate? Is the roadmap ordered correctly?

---

## Executive summary

**Architecturally: yes — this is the best 0DTE design shipped so far.**  
**Operationally: not yet — the platform’s cross-product resources are under-utilized.**

The thesis-first pipeline (discover → merge by ticker → archetype → gates → expression → commit) is the correct shape. What is live today is **v1 of that shape**, still fed mostly by Night Hawk’s legacy setup object via `railHitsFromLegacySetup()`, not by a unified evidence layer from Helix, Thermal, Vector, Meridian, etc.

Measured on prod (2026-08-25 RTH, post–phase-2 deploy):

| Metric | Pre-thesis deploy | Post-thesis deploy |
|--------|-------------------|---------------------|
| Setups with `thesis_first` | 0 / 60 | **79 / 79** |
| Multi-rail (2+ systems aligned) | **0** | **46 / 79 (~58%)** |
| Solo BREAKOUT still rank A | ~15 names | Cap shipped in #2901 (pending deploy) |
| Session governor | HALTED (8 losers vs max 5) | No new commits rest of session |

**Verdict:** Selection/ranking improved materially; commit-quality proof waits on the next unhalted session and outcome calibration.

---

## What is genuinely strong

### 1. Pipeline separation is correct

- **Discovery is DTE-agnostic** — rails fire on the name/direction thesis.  
- **Expression is separate** — contract engine picks strike/DTE after thesis + gates.  
- **Single merge unit** — one ticker, one direction panel, N rails (`mergeScanPassTheses` / `buildMergedThesisFromHits`).

Code: `src/lib/zerodte/thesis/pipeline.ts`, `live-pipeline.ts`, `contract-engine.ts`.

### 2. Fail-closed stack is institutional

Discovery → confluence → thesis attach → hard gates (G-1…G-17) → Cortex → governor → session loss halt.

Nothing fabricates numbers; absence is honest (LARGO contract C3).

### 3. Live rollout was done correctly

- Shadow wire (#2898) before live flag.  
- `ZERODTE_THESIS_FIRST=1` in Secrets Manager before expecting commit-path behavior.  
- Phase 2 (#2900): live blocks, contract reorder, CATALYST/VOL rails, rank card UI.

### 4. Calibration culture exists

Offline harnesses (`merge-precedence-ab`, `discovery-recall-probe`, `helix-score-signal`, `wall-temporal-stability`) and `docs/audit/INTENTIONAL-DESIGN.md` — change behavior only after measurement.

### 5. Cross-product contract exists for the long game

`docs/audit/LARGO-PRODUCT-CONTRACT.md` — ProductRead wrapper, additive fields, no fabricated confidence. Thesis-first is the Night Hawk implementation of “merge evidence before commit”; LARGO is the cross-desk join layer.

---

## The core gap: resources ≠ thesis inputs (yet)

Thesis rails today are built in `src/lib/zerodte/thesis/rails/legacy-bridge.ts` from fields already on `EnrichedZeroDteSetup`. They do **not** read Helix/Thermal/Vector/Meridian as first-class cache-reader inputs.

| Platform resource | Thesis rail today | Gap |
|-------------------|-------------------|-----|
| **Helix** (flow prints, campaigns) | FLOW rail via `gross_premium`, `flow_quality` on setup | No independent Helix rail; `helix-score-signal.mjs` → score **does not rank direction** (SPREAD WITHOUT ORDER at all horizons) |
| **Thermal** (GEX matrix, walls, charm/DEX) | POSITIONING via `gamma_regime`, `key_resistances`/`key_supports` | Not full Thermal book; no charm/DEX in expression; `cross_validation` not in rails |
| **Vector** (levels, beads, structure) | BREAKOUT via resistance/support on setup | No bead-confluence rail; no Vector session structure state |
| **Meridian / news** | CATALYST via `catalyst_flags`, `news_hot`, `earnings` | No expected-move / positioning intel join |
| **Chart technics** | MOMENTUM, REVERSAL, RS from intraday + RSI | No multi-TF Vector confluence |
| **Dark pool / lit** | — | Not a rail; could corroborate FLOW/BREAKOUT |
| **Cortex** | Separate judge post-thesis (`cortex-gate.ts`) | Overlaps thesis; two “brains” unless roles are crisp |

**Design maturity (rough):**

- Pipeline / archetypes / contract engine: **~75%**  
- Cross-product evidence utilization: **~30%**  
- Outcome-calibrated edge proof: **~10%**

---

## Design gaps (specific, actionable)

### G1 — Two merge stories

- **Board merge:** `mergeSameTickerDiscovery` + `merge_policy_version: "v2"` (evidence-weighted direction, INTENTIONAL-DESIGN §1).  
- **Thesis merge:** `mergeScanPassTheses` in thesis pipeline.

They can disagree on direction/ownership. **Target state:** one canonical `MergedThesis` per ticker per scan pass; discovery origins become provenance on that object, not a parallel fight.

### G2 — Rank tier is rule-based, not calibrated

`resolveThesisRankTier()` (live-pipeline.ts) uses score + archetype gates. **No closed loop** from graded ledger outcomes (“A tier 30d WR vs B tier”). Rank is honest ordering, not proven edge.

**Review ask:** Should rank tiers be frozen until a 20-session calibration pass completes?

### G3 — Solo BREAKOUT quality hole (partially patched)

Pre-patch: ~15 solo-rail BREAKOUT names still rank **A**.  
#2901 caps solo BREAKOUT at **WATCH** unless FLOW or MOMENTUM ≥ 55.

**Deeper fix:** COMMIT requires N independent systems (not just rank display). Gate `single_rail_corrobor` (#2895) handles commit path; thesis rank must stay aligned.

### G4 — POSITIONING / PIN rail under-fires

0DTE healthcheck (2026-08-25): **0 live PIN setups**. Either rail thresholds are too strict or positioning fields aren’t reaching setups. Measure before claiming “8 rails live.”

### G5 — Cortex veto is stateless

INTENTIONAL-DESIGN §2: veto recomputed every pass, no hysteresis → flicker risk. Thesis gates add structure; Cortex can still churn. `veto-flicker-rate.mjs` is the measurement path.

### G6 — UI path ≠ model path (fixed in #2901)

ThesisRankCard shipped on `ZeroDteBoard` PlayDetail; members use **CommandDeck + PlayTerminal**. #2901 wires `thesis_first` → `TerminalPlay.thesisFirst` on the Thesis tab.

### G7 — No outcome join on thesis snapshot yet

Committed rows stamp compact `entry_context.thesis_first` (`thesisFirstEntryContext`). **No dashboard** yet for “WR by `systems_aligned`, archetype, rank_tier`” — needed before tightening gates further.

### G8 — Session governor masked commit proof today

Governor halted: 8 realized losers vs max 5. Open book (APLD, RUM) was **pre-thesis** solo BREAKOUT. **First clean commit read: next RTH session.**

---

## Efficiency improvements (no per-request provider calls)

Cache-reader rule: new live features must read shared Redis/cron snapshots, not upstream providers per scan.

### E1 — Evidence bundle (one module, one pass)

Per ticker per scan, assemble from existing caches:

```
{
  helix:   top print / campaign flag (Redis HELIX snapshot)
  thermal: posture + nearest walls (gex-heatmap cache)
  vector:  nearest bead / level / structure (vector board cache)
  catalyst: meridian/earnings if in window
}
```

Feed all rails from this bundle. **Single read path; no parallel re-fetch.**

Proposed location: `src/lib/zerodte/thesis/evidence-bundle.ts` (reads only cache-reader APIs).

### E2 — Collapse duplicate scoring

Today: setup `score`, thesis `archetype_score`, Cortex, tier engine partially re-score the same facts.

**Proposed ownership:**

| Layer | Owns |
|-------|------|
| Thesis rails + merge | Evidence panel + archetype |
| Thesis gates + rank tier | Watch vs commit candidacy (display) |
| Hard gates G-* | Fail-closed commit law |
| Cortex | Veto / abstain only |
| Tier engine | Post-commit merit label (frozen at commit) |

### E3 — Regime-adaptive rail weights

`market_state` already on board payload (Phase 2b). Thesis merge should weight rails by regime (trend → BREAKOUT/MOMENTUM; chop → REVERSAL/PIN), not equal merge.

### E4 — Expression uses positioning

Contract engine (`pickBestExpression`) today: chain economics + theta. **Add:** prefer strikes away from Thermal call wall / toward vacuum bands when POSITIONING rail fired.

---

## Win rate — what actually moves the number

Win rate = **selection × exit × sizing**. Thesis-first mainly improves **selection**.

| Lever | Mechanism | Status |
|-------|-----------|--------|
| Multi-rail commit requirement | Fewer solo momentum chase commits | Partial — corroboration gate + thesis cap |
| Archetype-specific exits | BREAKOUT trail vs MR tight target | Not shipped — one ratchet/trim spine |
| Time-of-day sizing | Governor `time_of_day_sizing_factor` | Live — extend to thesis rank |
| Outcome calibration | Grade rank_tier / archetype on minute bars | **Not wired — highest ROI research** |
| Breakout temporal stability | Multi-snapshot wall agreement | Harness exists, not in gates |
| FLOW CAMPAIGN vs EVENT | Block EVENT-only “campaign” archetypes | Partially in FLOW rail |

**Honest expectation:** Thesis-first should **reduce bad commits** and **surface better WATCH names**. WR lift requires calibration loop + possibly archetype exits — not UI alone.

---

## Recommended build order (reviewers: validate priority)

### Phase A — Measure (next 5 sessions, no behavior change)

1. Log per session: `% multi-rail commits`, `thesis_gate_blocks` vs legacy rejects, WR by `rank_tier` / `systems_aligned` / `trade_archetype`.  
2. Run `node scripts/audit/thesis-first-live-audit.mjs` at open + mid + close.  
3. Fold results into `docs/audit/RUN-LOG.md` (not FINDINGS unless RED).

### Phase B — Evidence bundle (one PR)

- Cache-reader module; enrich legacy-bridge or add thin product rails.  
- **No new provider calls.**

### Phase C — Unify merge (one PR, deploy-risky)

- Single `MergedThesis` drives direction + `discovery_origin` display.  
- Deprecate conflicting v2 origin fight when thesis disagrees.

### Phase D — Calibrated rank (offline → gate)

- Grade 90d ledger by frozen `entry_context.thesis_first`.  
- Adjust `resolveThesisRankTier` thresholds from data.  
- Optionally: COMMIT requires `systems_aligned >= 2` when calibrated WR supports it.

### Phase E — Archetype exits (later)

- Only after selection WR proves out on calibrated cohorts.

---

## Files & PRs referenced

| Item | Location / PR |
|------|----------------|
| Thesis types & env | `src/lib/zerodte/thesis/types.ts` |
| Live attach | `src/lib/zerodte/thesis/live-pipeline.ts` |
| Legacy bridge (current rail source) | `src/lib/zerodte/thesis/rails/legacy-bridge.ts` |
| Scan integration | `src/lib/zerodte/scan.ts` |
| Command Deck UI | `src/features/nighthawk/command-deck/PlayTerminal.tsx` (#2901) |
| Foundation | #2897 |
| Shadow wire | #2898 |
| Phase 2 live | #2900 |
| Deck + rank cap | #2901 |
| Live audit script | `scripts/audit/thesis-first-live-audit.mjs` |
| Intentional design | `docs/audit/INTENTIONAL-DESIGN.md` |
| Largo contract | `docs/audit/LARGO-PRODUCT-CONTRACT.md` |

---

## Questions for reviewer (Claude)

1. **Merge unification (G1):** Should thesis merge replace board v2 merge entirely, or should board merge become a view on `MergedThesis`?  
2. **Rank calibration (G2):** Minimum sample size before promoting “A tier requires 3+ rails” to a commit gate?  
3. **Evidence bundle (E1):** Which cache keys are canonical per product (Helix/Thermal/Vector) — avoid inventing parallel paths?  
4. **Cortex role:** Keep as veto-only, or fold veto reasons into thesis `archetype_gates`?  
5. **PIN rail (G4):** Is under-fire a bug (missing setup fields) or correct strictness?  
6. **Roadmap order:** Is B → C → D the right sequence, or should calibration (D) precede evidence bundle (B)?

---

## Bottom line (one paragraph)

We have the **best architectural design so far** for 0DTE: thesis-first correctly separates discovery, evidence merge, archetype classification, gating, and expression. Live prod proves the **merge layer works** (0% → 58% multi-rail). We have **not yet** turned the full desk—Helix, Thermal, Vector, beads, catalysts, levels—into first-class thesis inputs; rails still bridge from the legacy setup. Closing that gap via a **cache-backed evidence bundle**, **unified merge**, and **outcome-calibrated rank tiers** is the path from “best design” to “best results.” Reviewers should stress-test G1–G8, the efficiency rules (E1–E4), and whether Phase A–E ordering matches deploy risk and measurement discipline.
