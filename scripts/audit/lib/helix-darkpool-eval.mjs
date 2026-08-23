/**
 * Pure evaluation for the HELIX dark-pool inventory.
 *
 * ── WHY THE DARK-POOL HALF NEEDED ITS OWN INSTRUMENT ────────────────────────────────────────────
 *
 * The charter defines HELIX as the options-flow AND dark-pool tape reader. `HELIX-MAP.md`'s Phase 0
 * inventory covers the options tape field by field and says essentially ONE line about dark pool.
 * That gap is this module's reason to exist: half the lane had no measurement at all.
 *
 * ── THE DISTINCTION THIS MODULE EXISTS TO DRAW ──────────────────────────────────────────────────
 *
 * A fill rate is not a fact about a field's INFORMATION CONTENT.
 *
 * MEASURED live 2026-08-23 (market-wide `/api/market/dark-pool`, 40 prints): every field is 100%
 * filled — `ticker`, `premium`, `side`, `executed_at`, `share_size`. A fill-rate inventory of the
 * kind `meridian-earnings-data-inventory.mjs` produces would report `side: 100% ALWAYS` and a reader
 * would design a directional panel on it.
 *
 * But **all 40 values are the literal string `"neutral"`**. The field is fully populated and carries
 * no information: UW's market-wide endpoint omits direction, and `dark-pool/route.ts:27` maps
 * anything that is not buy/sell to `"neutral"`. So the honest measure is not "is it present" but
 * "does it VARY" — `distinctValues` and `informativeRate` below, reported beside the fill rate so
 * the two can never be confused again.
 *
 * CLAUDE.md already records that a fill rate without its COHORT is not a fact about the field. This
 * is the same lesson one turn further on: a fill rate without its VARIANCE is not one either.
 */

/** Fields the dark-pool row contract declares (`DarkPoolRow` in `src/lib/api.ts`). */
export const DARK_POOL_FIELDS = ["ticker", "premium", "side", "executed_at", "share_size"];

/** Values `dark-pool/route.ts` collapses an unreported direction into. */
export const UNINFORMATIVE_SIDE = "neutral";

/**
 * Per-field: how often it is present, AND how much it varies. A field that is always present and
 * always the same value is reported as `informative: false` — present, and useless.
 */
export function fieldInventory(prints) {
  if (!Array.isArray(prints) || prints.length === 0) return null;
  const out = {};
  for (const field of DARK_POOL_FIELDS) {
    const values = prints.map((p) => p?.[field]);
    const present = values.filter((v) => v != null && v !== "").length;
    const distinct = new Set(values.filter((v) => v != null && v !== "").map(String));
    out[field] = {
      present,
      total: prints.length,
      fillPct: (present / prints.length) * 100,
      distinctValues: distinct.size,
      // One distinct value across the whole sample means the field cannot discriminate between any
      // two rows — whatever its fill rate says.
      informative: distinct.size > 1,
      sampleValues: Array.from(distinct).slice(0, 4),
    };
  }
  return out;
}

/**
 * Can a directional read be made at all, and over how much of the premium?
 *
 * `biasFromSide` in `DarkPoolPanel.tsx` sums buy and sell premium and computes a ratio. Its guard
 * fires only when NEITHER side is present, so a partially-sided population yields a verdict computed
 * over whatever fraction happens to carry a side — the rest silently dropped. That is the same
 * minority-verdict shape `directionLabel` refuses for split flow.
 *
 * MEASURED 2026-08-23: 0 of 40 prints carry a side, so the guard fires and the panel correctly
 * renders `—`. The weakness is therefore **latent, not live**, and is reported as coverage rather
 * than fixed on a guess — a speculative change to a guard that is currently correct is how the next
 * defect ships.
 */
export function directionalCoverage(prints) {
  if (!Array.isArray(prints) || prints.length === 0) {
    return { status: "NO_DATA", sidedPrints: 0, totalPrints: 0, sidedPremiumPct: null };
  }
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const sided = prints.filter((p) => p?.side === "buy" || p?.side === "sell");
  const sidedPremium = sided.reduce((s, p) => s + num(p.premium), 0);
  const totalPremium = prints.reduce((s, p) => s + num(p.premium), 0);
  const sidedPremiumPct = totalPremium > 0 ? (sidedPremium / totalPremium) * 100 : 0;

  if (sided.length === 0) {
    return {
      status: "NO_DIRECTION_REPORTED",
      sidedPrints: 0,
      totalPrints: prints.length,
      sidedPremiumPct: 0,
      note: "the panel's no-side-data guard fires and it correctly renders '—'",
    };
  }
  // The case the guard does not cover: some sides present, most absent, and a verdict computed
  // from the minority with the majority dropped.
  const status = sidedPremiumPct >= 50 ? "DIRECTIONAL" : "MINORITY_VERDICT_RISK";
  return {
    status,
    sidedPrints: sided.length,
    totalPrints: prints.length,
    sidedPremiumPct,
    note:
      status === "MINORITY_VERDICT_RISK"
        ? `a bias would be computed over ${sidedPremiumPct.toFixed(1)}% of the premium, with the rest silently dropped`
        : undefined,
  };
}

/** Freshness of the newest print, in hours. Null when unreadable — never 0, which would read as live. */
export function newestPrintAgeHours(prints, nowMs) {
  if (!Array.isArray(prints) || !prints.length) return null;
  const times = prints
    .map((p) => Date.parse(p?.executed_at ?? ""))
    .filter((t) => Number.isFinite(t));
  if (!times.length) return null;
  return (nowMs - Math.max(...times)) / 3_600_000;
}
