> **kind:** FINDING

## 2026-11-07 — `docs/audit/THERMAL-MAP.md` §9.5/§9.6 described two route-registry defects as open findings that PR #2753 already fixed on 2026-08-23 — FIXED (docs)

| **Status** | FIXED on `fix/thermal-map-stale-route-registry-findings` (docs-only) |
| --- | --- |

**Symptom:** `docs/audit/THERMAL-MAP.md` §9.5 and §9.6 — part of the "Findings opened while
mapping... **Recorded here, not fixed**" section — described two `route-registry.ts` defects as
currently live:

- §9.5: `/api/market/heatmap`'s registry description reads *"GEX/VEX/DEX/CHARM heatmap matrix
  (Thermal)"* even though that route serves sector performance/movers, not the Thermal matrix —
  feeding a wrong manifest line into the BIE knowledge base.
- §9.6: `/api/market/gex-heatmap/explain` (an `anthropicText` LLM-cost route) is registered
  `class:"read"` instead of `class:"mutation"`, contradicting the registry's own stated rule that
  cost/LLM routes must be denied-by-classification.

Both were real when the map was written (2026-08-22/23). Both were fixed the same week by **PR
#2753** ("Thermal Phase 0 follow-up: route registry fixes and empty heatmap consistency",
2026-08-23) — its second commit explicitly corrects the `/api/market/heatmap` description, adds
"(dealer positioning matrix)" to `/api/market/gex-heatmap`'s, and flips `explain`'s class to
`"mutation"`. Unlike §9.1–§9.4 in the same file (each of which got a `— FIXED` heading and a
live-validation paragraph when its fix landed), §9.5 and §9.6 were never updated — so the map has
read "not fixed" on two already-fixed defects for roughly eleven weeks.

**Verification against current `main` (`098d84a08`, 2026-11-07):**

```
src/lib/route-registry.ts:59: { path: "/api/market/heatmap", ..., description: "Sector performance and market movers." }
src/lib/route-registry.ts:60: { path: "/api/market/gex-heatmap", ..., description: "GEX heatmap surface for a ticker (dealer positioning matrix)." }
src/lib/route-registry.ts:61: { path: "/api/market/gex-heatmap/explain", ..., class: "mutation", description: "LLM-powered narrative summary of GEX heatmap — cached per ticker (~180s), calls Claude on miss." }
```

`git log --oneline -- src/lib/route-registry.ts` shows exactly one commit since the pre-migration
baseline that touches the file post-map: `9430d9ea6` = PR #2753. `route-registry.test.ts` (9/9,
Node 20) still passes against the corrected registry. The `callInternalApiRead`-sends-no-credential
half of §9.6 (and the open cross-lane question in §10 item 8) was **not** part of this fix and is
left exactly as-is — only the classification/description half is marked resolved.

**Fix (docs-only):** `docs/audit/THERMAL-MAP.md` §9.5 and §9.6 headings now carry `— FIXED` (§9.6
scoped to the classification half only, since the credential question stays open), each followed by
a `**FIXED — #2753 (2026-08-23)**` paragraph quoting the corrected registry lines and the 2026-11-07
re-verification, matching the style already used for §9.1–§9.4. One sentence inside §9.6's body
("The misclassification is latent, not live") was reworded since it no longer describes current
state — the route still 401s to `call_internal_api` for the credential reason, independent of the
now-fixed classification.

**Blast radius:** `docs/audit/THERMAL-MAP.md` only — no source files changed.

**Evidence:**
- `git show 9430d9ea6 -- src/lib/route-registry.ts` confirms the exact diff that fixed both
  descriptions and the `explain` class.
- Direct read of `src/lib/route-registry.ts` on `main` at `098d84a08` confirms the fix is still in
  place today.
- `npx tsx --experimental-test-module-mocks --test src/lib/route-registry.test.ts` — 9/9 pass
  (Node 20.20.0).
- `npx tsc --noEmit` — only the two pre-existing `legacy-option-marks-server.ts` errors from the
  nighthawk lane's known-red `main` (commit `098d84a08`); nothing new from this docs change.
- Full `npm test` run before merge (docs-only change, no source touched).

Found via lead #3 in the round-374 prompt ("read THERMAL-MAP.md and MERIDIAN-MAP.md fully for stale
present-tense claims... cross-check against the actual current source").
