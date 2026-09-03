// The cross-product read, as a callable unit.
//
// Fans out to five product tools, adapts each result to a contract contribution, and joins them.
// This is what makes "where do Helix and Vector disagree?" answerable at all.
//
// DEPENDENCY-INJECTED EXECUTOR. It takes the tool runner as a parameter rather than importing
// `runLargoTool`, for two reasons: `run-tool.ts` will import THIS module to register the tool, so a
// direct import is a cycle; and injection means the fan-out can be tested with a fake executor and
// no network, DB or provider graph.
//
// GOING THROUGH THE TOOL LAYER, not the product modules, is deliberate. Five lanes are rewriting
// their internals concurrently; the tool names are the stable interface and the product functions
// are not. This also means the cross-product read automatically inherits every fix a lane ships.

import { joinProductSignals, coverage, type CrossProductRead } from "./cross-product";
import {
  helixContribution,
  meridianContribution,
  nighthawkContribution,
  spxContribution,
  thermalContribution,
  vectorContribution,
} from "./product-adapters";
import { canonicalTicker } from "./product-read";
import { etStamp, etSessionDate } from "@/lib/largo/temporal/bar-session-date";
import { isSpxTicker } from "@/features/spx/lib/spx-desk-live";

export type ToolExecutor = (name: string, input: Record<string, unknown>) => Promise<unknown>;

type Source = {
  tool: string;
  input: (ticker: string) => Record<string, unknown>;
  adapt: (payload: unknown) => ReturnType<typeof helixContribution>;
  label: string;
};

const SOURCES: Source[] = [
  { tool: "get_helix_tape_analytics", input: (t) => ({ ticker: t }), adapt: helixContribution, label: "helix" },
  { tool: "get_helix_thermal_compare", input: (t) => ({ ticker: t }), adapt: thermalContribution, label: "thermal" },
  { tool: "get_vector_pulse", input: (t) => ({ ticker: t }), adapt: vectorContribution, label: "vector" },
  { tool: "get_earnings", input: (t) => ({ ticker: t }), adapt: meridianContribution, label: "meridian" },
  { tool: "get_zerodte_plays", input: () => ({}), adapt: nighthawkContribution, label: "nighthawk" },
  { tool: "get_spx_play", input: () => ({}), adapt: spxContribution, label: "spx" },
];

export type CrossProductPayload = CrossProductRead & {
  as_of: string | null;
  session_date: string | null;
  coverage: ReturnType<typeof coverage>;
  /** How to read this — the model must not turn a split into a pick. */
  reading_note: string;
};

/**
 * Read every product's view of one ticker and join them.
 *
 * A product whose tool THROWS becomes an explained absence rather than failing the whole read —
 * one lane being down must not make the cross-product question unanswerable. `Promise.allSettled`
 * rather than `all` for exactly that reason.
 */
export async function crossProductRead(
  rawTicker: string,
  execute: ToolExecutor,
  nowMs: number = Date.now()
): Promise<CrossProductPayload> {
  const ticker = canonicalTicker(rawTicker || "SPX") || "SPX";

  const settled = await Promise.allSettled(
    SOURCES.map((s) => {
      if (s.label === "spx" && !isSpxTicker(ticker)) {
        return Promise.resolve(null);
      }
      return execute(s.tool, s.input(ticker));
    })
  );

  const contributions = SOURCES.map((s, i) => {
    const r = settled[i];
    if (s.label === "spx" && !isSpxTicker(ticker)) {
      return spxContribution(null, ticker);
    }
    if (r.status === "rejected") {
      const why = r.reason instanceof Error ? r.reason.message : String(r.reason);
      // Naming the tool matters: "thermal unavailable" and "get_helix_thermal_compare threw" send
      // an operator to different places.
      return {
        product: s.label as never,
        signal: null,
        missingReason: `${s.tool} failed: ${why.slice(0, 160)}`,
      };
    }
    return s.label === "spx" ? spxContribution(r.value, ticker) : s.adapt(r.value);
  });

  const joined = joinProductSignals(ticker, contributions);
  const cov = coverage(joined);

  return {
    ...joined,
    // Contract C1 — an ET stamp and session date, from the shared helpers.
    as_of: etStamp(nowMs),
    session_date: etSessionDate(nowMs),
    coverage: cov,
    reading_note:
      joined.verdict === "split"
        ? `${cov.label}. These products genuinely disagree — report BOTH readings and their evidence. Do not resolve the split, pick a side, or present the larger camp as the answer.`
        : joined.verdict === "insufficient"
          ? `${cov.label}. Too few products reported to cross-check. Say so — do not present one product's read as a cross-product conclusion.`
          : `${cov.label}. The reporting products agree. State the coverage: an agreement among two is not an agreement among six.`,
  };
}
