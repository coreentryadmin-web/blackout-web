/**
 * DRILL-DOWN ACTIONS — "show me on the desk", with links that are guaranteed to exist.
 *
 * An answer that ends with a working link into Thermal for the strike it just described is worth
 * more than the same answer alone. But a link is only worth anything if it RESOLVES, and this is a
 * place a language model fails in a specific, embarrassing way: it produces plausible URLs. It has
 * seen `/night-hawk` and `/swings` in this codebase's own prose, and neither is a route — the real
 * paths are `/nighthawk` and there is no swings page at all (see CLAUDE.md, learned the hard way
 * when an unstyled Times render turned out to be the 404 page rather than a CSS failure).
 *
 * A 404 in an otherwise correct answer is worse than no link: it makes the whole answer look made
 * up, including the parts that were right.
 *
 * So the routes live HERE, as a closed set, checked against the app router by test. The model does
 * not compose URLs — it is handed the ones that exist for this turn's entities, and told to use
 * those or none.
 *
 * PURE AND TOTAL: no IO, no clock, no throw.
 */

import type { CanonicalTicker } from "./entities";

/**
 * Every desk route Largo may link to.
 *
 * Asserted against `src/app/(site)/*` by drilldown.test.ts, so deleting or renaming a page breaks
 * the build rather than shipping a dead link into member-facing answers.
 */
export const DESK_ROUTES = {
  nighthawk: { path: "/nighthawk", label: "Night Hawk", about: "the live 0DTE board and committed plays" },
  terminal: { path: "/terminal", label: "SPX Terminal", about: "the SPX desk — structure, levels, matrix" },
  flows: { path: "/flows", label: "Helix", about: "the live options-flow tape" },
  heatmap: { path: "/heatmap", label: "Thermal", about: "dealer gamma positioning and the GEX matrix" },
  vector: { path: "/vector", label: "Vector", about: "the swing lane" },
  trackRecord: { path: "/track-record", label: "Track Record", about: "graded outcomes and win rate" },
  dashboard: { path: "/dashboard", label: "Dashboard", about: "the desk overview" },
} as const;

export type DeskRouteKey = keyof typeof DESK_ROUTES;

export type DrillDown = { label: string; href: string; about: string };

/** Routes that meaningfully accept a ticker. Linking `?ticker=` at a page that ignores it produces
 *  a link that "works" and lands somewhere unrelated, which is its own kind of wrong. */
const TICKER_AWARE: DeskRouteKey[] = ["flows", "heatmap", "terminal", "vector"];

/**
 * Build the drill-downs for a turn.
 *
 * Ticker-scoped links first (they are the ones a member actually wants after asking about a
 * name), then the unscoped desks. Capped, because a wall of links is noise and the model will
 * paste all of them.
 */
export function buildDrillDowns(
  entities: readonly CanonicalTicker[],
  limit = 6
): DrillDown[] {
  const out: DrillDown[] = [];
  // One instrument only. Two tickers × four desks is eight links nobody clicks, and choosing
  // which ticker matters is the model's job, not this function's — it takes the first.
  const t = entities[0];
  if (t) {
    for (const key of TICKER_AWARE) {
      const r = DESK_ROUTES[key];
      out.push({
        label: `${r.label} — ${t.key}`,
        href: `${r.path}?ticker=${encodeURIComponent(t.key)}`,
        about: r.about,
      });
    }
  }
  for (const key of ["nighthawk", "trackRecord"] as DeskRouteKey[]) {
    const r = DESK_ROUTES[key];
    out.push({ label: r.label, href: r.path, about: r.about });
  }
  return out.slice(0, Math.max(0, limit));
}

/**
 * The drill-down block for the system prompt.
 *
 * Phrased as a closed set on purpose: "use these exact hrefs or none". An invitation to link
 * would be an invitation to invent a path, and the model has seen `/night-hawk` and `/swings` in
 * this repo's own prose — neither of which resolves.
 */
export function formatDrillDownBlock(links: readonly DrillDown[]): string {
  if (links.length === 0) return "";
  return (
    "\n\n## Drill-down links (use these EXACT hrefs, or none — do not compose a URL)\n" +
    links.map((l) => `- [${l.label}](${l.href}) — ${l.about}`).join("\n") +
    "\nLink only where it genuinely helps the member go deeper. Never invent a path that is not on " +
    "this list; a dead link makes the whole answer look fabricated, including the parts that were right.\n"
  );
}
