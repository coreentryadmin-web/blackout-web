// Pure helper for swing-e2e-healthcheck.mjs Stage F (MARKS).
//
// WHY THIS EXISTS AS A SEPARATE FILE: the shipped TerminalPlay-shaped position object
// (GET /api/market/nighthawk/horizons?view=SWING → board.lanes.SWING.sections.MANAGING/
// SCALING_OUT/EXITING, see adapters.ts) never carried a top-level `mark`/`last_mark`/
// `optionMark` field — the live option mark lives at `contract.mid` and its freshness
// timestamp at `markAsOf` (a sibling of `contract`, not nested under it). The healthcheck
// had checked the wrong field names since it was built (#1191, 2026-08-06) and so reported
// EVERY live swing position as "mark=null" (AMBER) regardless of whether the real mark was
// fresh, stale, or genuinely missing — a false-negative harness bug, not a product defect.
// Extracted to its own pure/testable module the same way zerodte/legacy's healthchecks
// already separate verdict logic from the live-HTTP runner.

/**
 * Resolve the option mark + its freshness timestamp from a real swing position object
 * (the TerminalPlay-shaped rows nighthawk/horizons?view=SWING serves under
 * sections.MANAGING/SCALING_OUT/EXITING).
 *
 * Prefers the real schema (`contract.mid` + `markAsOf`) and falls back to the
 * previously-assumed (but never actually present) flatter field names, so a future schema
 * change that DOES add one of those flat fields is still picked up rather than silently
 * ignored.
 *
 * @param {any} p
 * @returns {{ mark: number|null, markTs: string|number|null }}
 */
export function resolveSwingPositionMark(p) {
  if (!p || typeof p !== "object") return { mark: null, markTs: null };
  const mark =
    (typeof p.contract?.mid === "number" ? p.contract.mid : null) ??
    (typeof p.mark === "number" ? p.mark : null) ??
    (typeof p.last_mark === "number" ? p.last_mark : null) ??
    (typeof p.optionMark === "number" ? p.optionMark : null);
  const markTs = p.markAsOf ?? p.mark_ts ?? p.last_mark_ts ?? p.mark_updated_at ?? null;
  return { mark: mark ?? null, markTs: markTs ?? null };
}
