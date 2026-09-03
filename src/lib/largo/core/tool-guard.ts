/**
 * TOOL GUARD — entitlement enforcement and per-tool diagnostics, in one place.
 *
 * Two things belong here for the same reason: they are the only two things that must happen on
 * EVERY tool call, and there were two hand-copied `runTool` closures (blocking and streaming) with
 * no enforcement and no timing in either. A rule that lives in two closures is a rule that will
 * eventually live in one.
 *
 * ── ENTITLEMENT ──────────────────────────────────────────────────────────────────────────────
 *
 * The capability registry has carried an `entitlement` field since it shipped and NOTHING read it.
 * A prompt instruction is not enforcement: the model decides what to call, and "do not call admin
 * tools for non-admins" is a suggestion to a system whose whole job is choosing tools. So the
 * check is here, in code, on the execution path — the only place a caller cannot route around.
 *
 * THE POLICY, stated because the alternative is a plausible-looking disaster: the registry is an
 * allowlist of **RESTRICTED** tools, not of permitted ones. When this shipped only 49 of the
 * then-116 tools were catalogued, and failing closed on the uncatalogued 67 would have silently disabled
 * most of Largo on the spot — with a symptom, "Largo got worse at everything", nearly impossible to
 * trace back here. The catalog has since caught up: 130 of 130 today, and `registry.test.ts` holds
 * the 1:1. But the rule does NOT rest on that number, and must not be re-argued from it — a gap
 * reopens the moment anyone adds a tool ahead of its capability, and that gap must not be able to
 * take Largo down with it. So a tool is denied only when the catalog explicitly says `admin` and
 * the viewer is not one. Cataloguing a tool can therefore only ever ADD a restriction, never remove
 * one by omission.
 *
 * A denial returns a structured refusal rather than throwing. The model needs to know it was
 * denied so it can say so; an exception would surface as a generic tool failure and get narrated
 * as "that data isn't available", which is a different and misleading claim.
 *
 * ── DIAGNOSTICS ──────────────────────────────────────────────────────────────────────────────
 *
 * Per-tool latency and outcome, so "Largo is slow" becomes "get_postgres_flows took 9.2s of an
 * 11s turn" — an answerable question. Never logs tool INPUT or OUTPUT: inputs carry tickers and
 * user ids, outputs carry the member's positions. Only names, timings and sizes.
 */

import {
  LARGO_CAPABILITIES,
  type Entitlement,
  type LargoCapability,
} from "@/lib/largo/registry/capability-registry";
import { roundResultForReading } from "./round-for-reading";
// Pure module, deliberately NOT `providers/anthropic` — see tool-result-cap.ts for why the constant
// was split out. This file must stay free of the SDK/telemetry/Redis graph.
import { exceedsToolResultCap, MAX_TOOL_RESULT_CHARS } from "@/lib/providers/tool-result-cap";

export type ToolCallDiagnostic = {
  tool: string;
  ms: number;
  /** Denied by entitlement — did not execute. */
  denied: boolean;
  /** Threw. Distinguished from `denied` because they need opposite fixes. */
  failed: boolean;
  /** Serialized result size. A tool returning 0 bytes is a silent-empty, not a success. */
  bytes: number;
  /**
   * This result is OVER the transport cap, so the model will be handed a head-slice of it.
   *
   * Derived from `bytes`, which this file has always measured and never compared to anything. That
   * omission is why three truncation defects (#2433, #2436, #2480) shipped and were each found only
   * by asking the live model whether its payload arrived — an over-cap tool still "succeeds", so
   * nothing here objected. The number was already in hand; only the comparison was missing.
   */
  truncated: boolean;
};

export type ToolGuardViewer = {
  userId: string;
  isAdmin: boolean;
};

/**
 * The entitlement the catalog declares for a tool, or null when the tool is uncatalogued.
 *
 * `catalog` is injectable ONLY so the enforcement path can be tested against a synthetic catalog.
 * As of this writing every one of the 134 catalogued capabilities declares `premium`, so against
 * the real registry this mechanism is armed but inert — it restricts nothing today. That is the
 * honest state: the gate is in place and proven, and the day a capability is marked `admin` it is
 * enforced in code rather than by asking the model nicely.
 */
export function declaredEntitlement(
  tool: string,
  catalog: readonly LargoCapability[] = LARGO_CAPABILITIES
): Entitlement | null {
  const cap = catalog.find((c) => c.tool === tool);
  return cap ? cap.entitlement : null;
}

export type Denial = { denied: true; reason: string; tool: string };

/**
 * Is this viewer allowed to run this tool?
 *
 * Returns the denial rather than a boolean so the reason travels to the model verbatim and can be
 * repeated to the member. "You need admin access for the scan-rejection log" is a usable answer;
 * a silent empty result is not.
 */
export function checkToolEntitlement(
  tool: string,
  viewer: ToolGuardViewer,
  catalog: readonly LargoCapability[] = LARGO_CAPABILITIES
): Denial | null {
  if (declaredEntitlement(tool, catalog) !== "admin") return null;
  if (viewer.isAdmin) return null;
  return {
    denied: true,
    tool,
    reason:
      `${tool} is an admin-only capability and this member is not an admin. It was NOT run. ` +
      `Say plainly that the data requires admin access — do not substitute another source and ` +
      `present it as the answer.`,
  };
}

export type GuardedRunnerOptions = {
  viewer: ToolGuardViewer;
  /** The real executor. Injected so this module stays free of the 130-tool dependency graph. */
  execute: (name: string, input: Record<string, unknown>, userId: string) => Promise<unknown>;
  /** Tools actually CALLED. Denied tools are excluded — see the note in the runner. */
  toolsUsed: string[];
  capturedResults: unknown[];
  diagnostics: ToolCallDiagnostic[];
  /** Injected for testability; defaults to the wall clock. */
  now?: () => number;
  /** Injected for testability; defaults to the real capability registry. */
  catalog?: readonly LargoCapability[];
};

/**
 * The single tool-execution path: check entitlement, run, time, record.
 *
 * Replaces two identical inline closures. Errors are re-thrown unchanged — the tool loop already
 * handles them, and swallowing one here would turn a hard failure into an empty result the model
 * would narrate as "no data", which is the exact confusion this file exists to prevent.
 */
export function makeGuardedToolRunner(opts: GuardedRunnerOptions) {
  const now = opts.now ?? (() => Date.now());
  return async function runGuarded(name: string, input: Record<string, unknown>): Promise<unknown> {
    const started = now();

    const denial = checkToolEntitlement(name, opts.viewer, opts.catalog);
    if (denial) {
      // Deliberately NOT pushed to `toolsUsed`. That array is persisted to the interaction log and
      // buckets calibration cohorts, so it must record tools that RAN. A denied call ran nothing;
      // recording it would make an admin-denied turn indistinguishable from one that used the tool.
      opts.diagnostics.push({ tool: name, ms: now() - started, denied: true, failed: false, bytes: 0, truncated: false });
      return denial;
    }

    opts.toolsUsed.push(name);
    try {
      // Round at the boundary where the data stops being COMPUTED WITH and starts being READ.
      // A live scan found 547 numbers carrying more decimals than any real measurement has
      // (`total_premium = 4276339.059400001`, `delta = 0.9160819881475173`). This is the only
      // place it is safe to do: every OTHER runLargoTool caller — full-platform-snapshot,
      // platform-context, helix-read — bypasses this runner and keeps full precision, and the
      // provider functions that feed compute paths are untouched. See round-for-reading.ts.
      const result = roundResultForReading(await opts.execute(name, input, opts.viewer.userId));
      opts.capturedResults.push(result);
      const bytes = sizeOf(result);
      opts.diagnostics.push({
        tool: name,
        ms: now() - started,
        denied: false,
        failed: false,
        bytes,
        truncated: exceedsToolResultCap(bytes),
      });
      return result;
    } catch (err) {
      opts.diagnostics.push({ tool: name, ms: now() - started, denied: false, failed: true, bytes: 0, truncated: false });
      throw err;
    }
  };
}

function sizeOf(result: unknown): number {
  try {
    return JSON.stringify(result)?.length ?? 0;
  } catch {
    // A circular or non-serializable result is a real condition, not a crash. 0 reads as "unknown
    // size" in the summary, which is accurate.
    return 0;
  }
}

/**
 * One-line turn summary for the server log.
 *
 * Names, milliseconds and byte counts only — never a tool's input or output. Inputs carry tickers
 * and user ids; outputs carry the member's positions. Slowest-first, because the reason anyone
 * reads this line is to find what cost the turn its time.
 */
export function formatToolDiagnostics(diagnostics: readonly ToolCallDiagnostic[]): string {
  if (diagnostics.length === 0) return "";
  const total = diagnostics.reduce((s, d) => s + d.ms, 0);
  const parts = [...diagnostics]
    .sort((a, b) => b.ms - a.ms)
    .map((d) => {
      // TRUNCATED carries its size because the number is the actionable part: "9.2s" tells you to
      // make a tool faster, "TRUNCATED 41203/16000" tells you exactly how much has to come off and
      // whether the fix is pagination or a leaner shape.
      const flag = d.denied
        ? " DENIED"
        : d.failed
          ? " FAILED"
          : d.truncated
            ? ` TRUNCATED ${d.bytes}/${MAX_TOOL_RESULT_CHARS}`
            : d.bytes === 0
              ? " EMPTY"
              : "";
      return `${d.tool} ${Math.round(d.ms)}ms${flag}`;
    });
  const denied = diagnostics.filter((d) => d.denied).length;
  const failed = diagnostics.filter((d) => d.failed).length;
  const empty = diagnostics.filter((d) => !d.denied && !d.failed && d.bytes === 0).length;
  const truncated = diagnostics.filter((d) => d.truncated).length;
  return (
    `[largo] tools: ${diagnostics.length} calls, ${Math.round(total)}ms total` +
    (denied ? `, ${denied} denied` : "") +
    (failed ? `, ${failed} failed` : "") +
    (empty ? `, ${empty} empty` : "") +
    // Named LAST in the counts but FIRST in severity: a slow tool gives a late answer, a truncated
    // one gives a confident answer built on a fragment. It is the only entry here that means the
    // member may have been told something false.
    (truncated ? `, ${truncated} TRUNCATED` : "") +
    ` — ${parts.join(" | ")}`
  );
}
