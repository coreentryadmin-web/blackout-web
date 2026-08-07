/**
 * Pure helpers for the SWING serving-section filter.
 *
 * WHY (FINDINGS 2026-08-06, swing A-to-Z audit P2): `src/lib/swing/serving.ts` correctly routes every
 * swing name into one of seven member-facing triage buckets — but `containers.tsx` then concatenated
 * all seven into one flat list, so a member could not filter to, say, just COMMIT_NOW. The section
 * survived only as a small per-card text badge. That is exactly the "undifferentiated list" problem
 * `serving.ts`'s own header says the router exists to prevent, reintroduced one layer up in the UI.
 *
 * Split out of the component so the counting/filtering rules are unit-testable without rendering:
 * the component keeps only the state and the markup.
 */
import { SWING_SERVING_SECTIONS, type SwingServingSection } from "@/lib/swing/serving";

/** "ALL" is the default view — every section concatenated, i.e. today's behaviour. */
export type SwingSectionFilter = SwingServingSection | "ALL";

/** The `sections` map as it arrives on a lane: any subset of the seven, each possibly absent. */
export type SwingSectionsMap = Partial<Record<SwingServingSection, unknown[]>>;

/**
 * Rows for the selected filter, in the canonical section order.
 *
 * ALL concatenates in `SWING_SERVING_SECTIONS` order — pre-entry buckets first (COMMIT_NOW …
 * RESEARCH), then live-position ones (MANAGING … EXITING) — which is the order a member reads the
 * board in: what can I act on, then what am I already in.
 */
export function rowsForSwingSection<T>(
  sections: Partial<Record<SwingServingSection, T[]>> | null | undefined,
  filter: SwingSectionFilter
): T[] {
  if (!sections) return [];
  if (filter !== "ALL") return sections[filter] ?? [];
  const out: T[] = [];
  for (const s of SWING_SERVING_SECTIONS) out.push(...(sections[s] ?? []));
  return out;
}

/**
 * Per-section counts plus the ALL total.
 *
 * EVERY section is present in the result even at zero. Empty buckets are deliberately NOT dropped:
 * a member needs to be able to see that COMMIT_NOW is empty — "nothing is actionable right now" is
 * real information, and silently hiding the bucket makes an empty board indistinguishable from a
 * board with no such bucket. (Same reasoning as the Helix "never silently drop empty panels" fix.)
 */
export function swingSectionCounts(
  sections: SwingSectionsMap | null | undefined
): Record<SwingSectionFilter, number> {
  const counts = { ALL: 0 } as Record<SwingSectionFilter, number>;
  for (const s of SWING_SERVING_SECTIONS) {
    const n = sections?.[s]?.length ?? 0;
    counts[s] = n;
    counts.ALL += n;
  }
  return counts;
}

/** Short button labels — the raw section names are too wide for a mobile filter row. */
export const SWING_SECTION_LABEL: Record<SwingSectionFilter, string> = {
  ALL: "ALL",
  COMMIT_NOW: "COMMIT",
  WAITING_FOR_ENTRY: "WAITING",
  WATCH: "WATCH",
  RESEARCH: "RESEARCH",
  MANAGING: "MANAGING",
  SCALING_OUT: "SCALING",
  EXITING: "EXITING",
};

/**
 * Why the selected section is empty — distinct from the lane being empty overall.
 *
 * Returning a section-specific line matters: with a filter applied, the generic "scanning the whole
 * market" hint is actively misleading, because the lane may be full while THIS bucket is empty.
 */
export function emptySwingSectionHint(
  filter: SwingSectionFilter,
  counts: Record<SwingSectionFilter, number>
): string | null {
  if (filter === "ALL" || counts[filter] > 0) return null;
  if (counts.ALL === 0) return null; // whole lane empty — the caller's own lane-level hint is right
  const total = counts.ALL;
  return `No names in ${SWING_SECTION_LABEL[filter]} right now — ${total} in other sections. Switch to ALL to see them.`;
}
