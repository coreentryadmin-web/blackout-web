/**
 * QUERY PLANNER — a suggested plan, and the check that the turn actually followed one.
 *
 * WHAT THIS IS NOT. It is not a router. It does not decide which tools run, and it cannot make a
 * capability unreachable — that was the deleted intent allowlist, which hid a mean 21.9 of 116
 * tools and failed silently on every phrasing nobody anticipated. The model still chooses. This
 * composes a PLAN from what deterministic code already resolved (entities, timeframe, ranked
 * capabilities, declared join edges) and hands it over as a starting point.
 *
 * THE PART THAT IS NEW is the second half: `validatePlanExecution`. After the tool loop, it asks a
 * question nothing in the system asked before — *did the turn consult a source capable of the
 * timeframe it just answered about?* The failure it catches is the one with no other detector:
 *
 *   A member asks what SPX looked like at 10:15. Largo calls get_quote (live_only), gets a real
 *   number, and writes a fluent answer. Every existing check passes — the number is real, it
 *   traces to this turn's tool results, the grounding ratio is 1.0. The answer is about the wrong
 *   moment and nothing downstream can tell.
 *
 * The temporal block already WARNS the model about this before the loop. This verifies it after,
 * which is the difference between an instruction and a control.
 *
 * A violation produces a caveat, never a suppressed answer. Deleting a possibly-correct answer on
 * a heuristic would be its own failure mode; saying "this used live sources for a question about
 * 10:15" hands the member the thing they need to judge it.
 *
 * PURE AND TOTAL: no IO, no clock, no throw.
 */

import type { LargoCapability } from "@/lib/largo/registry/capability-registry";
import type { Timeframe } from "@/lib/largo/temporal/timeframe";
import type { CanonicalTicker } from "./entities";

export type PlanStep = {
  capabilityId: string;
  tool: string;
  /** Why this step is in the plan, in the model's own decision terms. */
  why: string;
  /** Capability ids this step can be joined with, on a shared entity key. */
  joinsWith: string[];
};

export type QueryPlan = {
  /** Steps with no dependency on each other — issue them together, not in sequence. */
  parallel: PlanStep[];
  /** Instruments the plan is keyed on. Empty for a market-wide question. */
  entities: string[];
  timeframeLabel: string;
  /** Declared join edges among the planned steps — the cross-product surface, computed not guessed. */
  joins: Array<{ from: string; to: string; on: string }>;
};

/** Sources that can answer about a moment other than now. */
const PAST_CAPABLE = new Set(["windowed", "point_in_time", "event_log"]);

export function buildQueryPlan(input: {
  ranked: readonly LargoCapability[];
  entities: readonly CanonicalTicker[];
  timeframe: Timeframe;
  limit?: number;
}): QueryPlan {
  const limit = Math.max(0, input.limit ?? 6);
  // A historical question plans ONLY against past-capable sources. Not a preference — a live_only
  // source cannot answer it at all, and including it in the plan invites exactly the substitution
  // this module exists to catch.
  const pool = input.timeframe.historical
    ? input.ranked.filter((c) => PAST_CAPABLE.has(c.temporal))
    : input.ranked;
  const chosen = pool.slice(0, limit);
  const chosenIds = new Set(chosen.map((c) => c.id));

  const parallel: PlanStep[] = chosen.map((c) => ({
    capabilityId: c.id,
    tool: c.tool,
    why: c.answers,
    joinsWith: (c.joinsWith ?? []).filter((j) => chosenIds.has(j)),
  }));

  // Join edges are DERIVED from the registry's declared joins, which registry.test.ts already
  // proves share an entity key. Nothing here infers a correlation path.
  const joins: QueryPlan["joins"] = [];
  const seen = new Set<string>();
  const byId = new Map(chosen.map((c) => [c.id, c]));
  for (const c of chosen) {
    for (const j of c.joinsWith ?? []) {
      const other = byId.get(j);
      if (!other) continue;
      const key = [c.id, j].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      const shared = c.entities.find((e) => other.entities.includes(e));
      if (shared) joins.push({ from: c.id, to: j, on: shared });
    }
  }

  return {
    parallel,
    entities: input.entities.map((e) => e.key),
    timeframeLabel: input.timeframe.label,
    joins,
  };
}

/**
 * The plan, as prompt text.
 *
 * Phrased as a suggestion throughout. A plan the model reads as a limit would recreate the
 * allowlist failure in prose, so it says outright that it is a starting point and that every tool
 * stays callable.
 */
export function formatPlanBlock(plan: QueryPlan): string {
  if (plan.parallel.length === 0) return "";
  const lines = [
    "\n\n## Suggested plan (a starting point, NOT a limit — every tool remains callable)",
    `Timeframe: ${plan.timeframeLabel}.` +
      (plan.entities.length ? ` Instruments: ${plan.entities.join(", ")}.` : " No instrument named."),
    "Issue these together in ONE round rather than one at a time — they do not depend on each other:",
    ...plan.parallel.map((s) => `- ${s.tool} — ${s.why}`),
  ];
  if (plan.joins.length) {
    lines.push(
      "",
      "These results can be correlated (they share a key, so a cross-product claim is sound):",
      ...plan.joins.map((j) => `- ${j.from} ↔ ${j.to} on ${j.on}`)
    );
  }
  lines.push(
    "",
    "If the plan does not fit the question, ignore it and call what does."
  );
  return lines.join("\n");
}

export type PlanViolation = {
  code: "historical_answered_from_live_only" | "no_tools_called";
  detail: string;
};

/**
 * Did the turn actually consult a source capable of the question it answered?
 *
 * `catalogue` maps tool name → capability, so an UNCATALOGUED tool is invisible here — a violation
 * is raised only when EVERY tool the turn called is one the catalog positively knows to be
 * live-only.
 *
 * THAT USED TO MEAN THIS CHECK ALMOST NEVER FIRED. 67 of the then-116 tools had no catalog entry,
 * so most turns mixed a catalogued source with uncatalogued ones and fell straight through. The
 * guard was armed and dormant. Coverage is now complete (`registry.test.ts` asserts it stays that
 * way), so the check finally bites on the case it was written for.
 *
 * The invisible-when-uncatalogued behaviour is KEPT rather than inverted, because treating "I
 * cannot classify this tool" as "this tool cannot answer about the past" would fire on turns that
 * were fine, and a warning that cries wolf gets ignored. Silence still means "no proof of a
 * problem", never "proven fine".
 */
export function validatePlanExecution(input: {
  timeframe: Timeframe;
  toolsCalled: readonly string[];
  catalogue: readonly LargoCapability[];
}): { ok: boolean; violations: PlanViolation[] } {
  const violations: PlanViolation[] = [];
  if (!input.timeframe.historical) return { ok: true, violations };

  // Ignore the local prefetch markers pushed by the turn builder — they are not tool calls.
  const real = input.toolsCalled.filter((t) => input.catalogue.some((c) => c.tool === t));
  if (real.length === 0) {
    // Either nothing ran, or everything that ran is uncatalogued. Both mean this check has no
    // evidence, and inventing a verdict from no evidence is the failure mode it guards against.
    return { ok: true, violations };
  }

  const classes = real.map(
    (t) => input.catalogue.find((c) => c.tool === t)!.temporal
  );
  if (!classes.some((c) => PAST_CAPABLE.has(c))) {
    violations.push({
      code: "historical_answered_from_live_only",
      detail:
        `The question was about ${input.timeframe.label}, but every catalogued tool this turn used ` +
        `(${[...new Set(real)].join(", ")}) returns present-time data only.`,
    });
  }
  return { ok: violations.length === 0, violations };
}

/**
 * Append the violation to the answer as a caveat.
 *
 * Appended, never substituted. The answer may still be useful and the member is the one who
 * decides that; silently discarding it on a heuristic would be its own failure.
 */
export function applyPlanCaveat(text: string, violations: readonly PlanViolation[]): string {
  if (violations.length === 0) return text;
  const body = violations.map((v) => v.detail).join(" ");
  return `${text}\n\n> **Timeframe caveat.** ${body} Treat the numbers above as current, not as of that period.`;
}
