import type { EcosystemContext } from "@/lib/bie/ecosystem-context";
import { fitRowsToBudget, LARGO_RESULT_CHAR_BUDGET } from "@/lib/largo/fit-tool-result";
import { fitSpxPlayForModel } from "@/lib/largo/spx-play-fit";
import { sectionScope } from "@/lib/bie/vector-fit-scope";

const MAX_AUDIT = 5;
const MAX_ANOMALIES = 3;
const MAX_FLOW_PRINTS = 25;

export type EcosystemContextFitted = EcosystemContext & {
  recent_audit_entries_total?: number;
  recent_audit_entries_truncated?: boolean;
  recent_anomalies_total?: number;
  recent_anomalies_truncated?: boolean;
  flow_full_state_fit?: { recent_total: number; recent_shown: number; recent_truncated: boolean };
};

const size = (o: unknown) => JSON.stringify(o)?.length ?? 0;

type VectorRowPath = ["wallHistory"] | ["wallEvents"] | ["ladder", "rows"] | ["flowMarkers", "prints"];

/**
 * Row sections to drop, in order, when `vector_full_state` is still too big for its siblings
 * even after `fetchEcosystemContext`'s own pre-fit (`fitVectorFullStateForModel`, no budget
 * override — see the module doc). LOWEST information-density first, mirroring that module's own
 * fill priority in reverse ("filled in descending order of information per byte: wallEvents,
 * ladder.rows, flowMarkers.prints, wallHistory" — so the raw beads, which the other three already
 * summarize, are the first thing this drops, and the narration events are the last).
 */
const VECTOR_ROW_SECTIONS: ReadonlyArray<{
  path: VectorRowPath;
  scopeKey: "wall_history" | "wall_events" | "ladder_rows" | "flow_prints";
  noun: string;
  keptDescription: string;
}> = [
  { path: ["wallHistory"], scopeKey: "wall_history", noun: "bead samples", keptDescription: "Most recent, ascending by time" },
  { path: ["flowMarkers", "prints"], scopeKey: "flow_prints", noun: "flow prints", keptDescription: "Largest premium first" },
  { path: ["ladder", "rows"], scopeKey: "ladder_rows", noun: "ladder strikes", keptDescription: "Nearest spot, with both king strikes retained" },
  { path: ["wallEvents"], scopeKey: "wall_events", noun: "wall events", keptDescription: "Most recent, ascending by time" },
];

const VECTOR_AGGREGATE_HINT =
  "Every derived field above (wall events, wall integrity, magnet, proximity, the play) was " +
  "computed server-side over the FULL set, not over this sample — cite those, never a count of " +
  "the rows visible here.";

/**
 * Clear ONE already-fit row section of `vfs` to empty, honestly updating its own `fit.<section>`
 * disclosure in place. The `total` that section's disclosure already carries (recorded by
 * `fetchEcosystemContext`'s earlier, budget-unaware fit pass) is preserved VERBATIM — only
 * `returned`/`truncated`/`note` move — so a reader never sees a smaller `total` than the real
 * population just because a second, tighter pass ran. Mutates `vfs` in place; the caller already
 * owns a fresh shallow copy (see `degradeVectorFullStateForBudget`).
 */
function zeroVectorRowSection(
  vfs: Record<string, unknown>,
  section: (typeof VECTOR_ROW_SECTIONS)[number]
): boolean {
  const [outerKey, innerKey] = section.path;
  const outer = vfs[outerKey];
  const arr = innerKey ? (outer && typeof outer === "object" ? (outer as Record<string, unknown>)[innerKey] : undefined) : outer;
  if (!Array.isArray(arr) || arr.length === 0) return false;

  if (innerKey) {
    vfs[outerKey] = { ...(outer as Record<string, unknown>), [innerKey]: [] };
  } else {
    vfs[outerKey] = [];
  }

  const fit = (vfs.fit && typeof vfs.fit === "object" ? { ...(vfs.fit as Record<string, unknown>) } : {}) as Record<
    string,
    { total?: number } | undefined
  >;
  const priorTotal = fit[section.scopeKey]?.total ?? arr.length;
  fit[section.scopeKey] = sectionScope(0, priorTotal, section.noun, section.keptDescription, VECTOR_AGGREGATE_HINT);
  vfs.fit = fit;
  return true;
}

/**
 * Last-resort degrade for `vector_full_state` when it is still too big for its siblings even
 * after `flow_full_state`/`spx_full_state` are already fit against the budget it left behind.
 *
 * Drops row-sample sections one at a time (lowest information density first) until the WHOLE
 * `vfs` fits `targetBudget` or every section is empty — never dropping a scalar (spot, regime,
 * gammaFlip, magnet, confluenceZones, the derived `play`, dark-pool levels, the VEX lens): those
 * are the actual answer, and every one of them was already computed over the FULL rail server
 * side, so losing the row samples costs nothing a reader needed to quote. Returns the same object
 * unchanged if it already fits.
 */
function degradeVectorFullStateForBudget<T extends Record<string, unknown>>(vfs: T, targetBudget: number): T {
  if (size(vfs) <= targetBudget) return vfs;
  const next = { ...vfs } as Record<string, unknown>;
  for (const section of VECTOR_ROW_SECTIONS) {
    if (size(next) <= targetBudget) break;
    zeroVectorRowSection(next, section);
  }
  return next as T;
}

/**
 * Largo transport fit — aggregates first, capped row samples, explicit truncation flags.
 *
 * `flow_full_state` and `spx_full_state` were each fit against the FULL `LARGO_RESULT_CHAR_BUDGET`
 * (14,000 chars) in total isolation — `flow_full_state` via `fitRowsToBudget(..., { budget:
 * LARGO_RESULT_CHAR_BUDGET })`, `spx_full_state` via `fitSpxPlayForModel(raw.spx_full_state)` with
 * no budget override at all, which defaults to the same full budget. Neither fit knew the other
 * field — or `vector_full_state` (already fit to up to ~14,000 chars of its own by
 * `fetchEcosystemContext` before this function ever sees it, per `vector-full-state-fit.ts`'s own
 * measurement: an unfit Vector rail can serialize to 900x+ the transport cap, so that pre-fit is
 * load-bearing, not decorative), `gex_positioning`, `spx_desk_convergence` or `arsenal` — existed.
 * Two or three sub-objects each individually "fitting" to 14,000 chars can together serialize to
 * well over the real 16,000-char transport cap (measured live-shaped: 24,104 chars for a ticker
 * carrying a busy Vector rail + a dense flow tape + an SPX play, ~50% over), at which point
 * `anthropicToolLoop`'s head-slice truncation (`raw.slice(0, MAX) + "…[truncated]"`) lands inside
 * whichever field serializes second and discards everything after it in key order — silently
 * dropping `arsenal` (the last key in `EcosystemContext`) and leaving an unterminated JSON
 * fragment, the exact defect SHAPE already fixed for `get_platform_snapshot`
 * (`platform-snapshot-fit.ts`, #6130/#6111-pattern: "a sub-object fit against its own standalone
 * budget, merged with sibling fields with no shared accounting"). This is the SAME ticker where it
 * bites hardest: `spx_full_state`/`spx_play` only populate for SPX/SPXW, which is also where
 * `vector_full_state`'s own bead rail is busiest and `flow_full_state` carries the densest tape —
 * i.e. the three heavy fields collide most on the single ticker members ask about most.
 *
 * Fixed in three steps, same ordering principle as `platform-snapshot-fit.ts` (decide the
 * cheaper/less-flexible fields first, fit the most-flexible one last against whatever remains):
 *   1. `flow_full_state`'s row cap is budget-aware of everything else already in `fitted`
 *      (including the pre-fit `vector_full_state`), instead of the full budget in isolation.
 *   2. `spx_full_state` is fit LAST among the two sub-object fitters (it can still shed
 *      `playbook_shadow`/`desk_context`/`telemetry`/`mtf`/`option_ticket` under pressure) against
 *      whatever `flow_full_state` left behind.
 *   3. If the total is STILL over budget afterward — `vector_full_state`'s own pre-fit alone can
 *      already consume most of the 14,000-char allotment on a busy rail, leaving too little for
 *      steps 1-2 to work with — `degradeVectorFullStateForBudget` drops `vector_full_state`'s row
 *      SAMPLES (beads/events/ladder rows/flow prints; never its scalars, which carry the actual
 *      read and were already computed over the full rail server-side) until the whole payload
 *      fits, honestly updating that field's OWN `fit.<section>` disclosure rather than silently
 *      shrinking it — the `total` each section already recorded is never altered, only
 *      `returned`/`truncated`/`note` move.
 */
export function fitEcosystemContextForModel(raw: EcosystemContext): { fitted: EcosystemContextFitted } {
  const fitted: EcosystemContextFitted = { ...raw };

  if (raw.recent_audit_entries.length > MAX_AUDIT) {
    fitted.recent_audit_entries = raw.recent_audit_entries.slice(0, MAX_AUDIT);
    fitted.recent_audit_entries_total = raw.recent_audit_entries.length;
    fitted.recent_audit_entries_truncated = true;
  }

  if (raw.recent_anomalies.length > MAX_ANOMALIES) {
    fitted.recent_anomalies = raw.recent_anomalies.slice(0, MAX_ANOMALIES);
    fitted.recent_anomalies_total = raw.recent_anomalies.length;
    fitted.recent_anomalies_truncated = true;
  }

  if (raw.flow_full_state?.recent?.length) {
    const base = { ...raw.flow_full_state };
    delete (base as { recent?: unknown }).recent;
    // Reserve against everything else already decided — EXCLUDING the still-raw, not-yet-fit
    // `spx_full_state` (it is fit after this, against whatever this leaves behind, so counting
    // its current unfit size here would double-reserve against it).
    const { spx_full_state: _spxOmitted, flow_full_state: _flowOmitted, ...reservedFields } = fitted;
    const flowBudget = Math.max(0, LARGO_RESULT_CHAR_BUDGET - size(reservedFields));
    const rowFit = fitRowsToBudget(base, "recent", raw.flow_full_state.recent, {
      budget: flowBudget,
      maxRows: MAX_FLOW_PRINTS,
    });
    fitted.flow_full_state = { ...raw.flow_full_state, recent: rowFit.kept };
    if (rowFit.total > rowFit.kept.length) {
      fitted.flow_full_state_fit = {
        recent_total: rowFit.total,
        recent_shown: rowFit.kept.length,
        recent_truncated: true,
      };
    }
  }

  if (raw.spx_full_state) {
    // Fit LAST among the two sub-object fitters, against whatever budget remains after every
    // sibling field above (now including the already-capped `flow_full_state`) is already
    // decided.
    const { spx_full_state: _spxOmitted, ...reservedFields } = fitted;
    const spxBudget = Math.max(0, LARGO_RESULT_CHAR_BUDGET - size(reservedFields));
    fitted.spx_full_state = fitSpxPlayForModel(raw.spx_full_state as Record<string, unknown>, {
      budget: spxBudget,
    }).fitted as typeof raw.spx_full_state;
  }

  // Last resort: even with flow/spx now budget-aware, a busy Vector rail's own pre-fit (done by
  // `fetchEcosystemContext` before this function ever runs, against the FULL budget in isolation)
  // can alone leave too little room for the fields above. Trim its row SAMPLES only — never its
  // scalars — to whatever is left once everything else is accounted for.
  if (fitted.vector_full_state) {
    const { vector_full_state: _vfsOmitted, ...reservedFields } = fitted;
    const vectorBudget = Math.max(0, LARGO_RESULT_CHAR_BUDGET - size(reservedFields));
    fitted.vector_full_state = degradeVectorFullStateForBudget(
      fitted.vector_full_state as unknown as Record<string, unknown>,
      vectorBudget
    ) as unknown as typeof fitted.vector_full_state;
  }

  return { fitted };
}
