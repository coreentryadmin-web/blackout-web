/**
 * G5 — Cortex veto dwell / hysteresis across scan passes.
 * Prevents stateless veto flicker: once vetoed, hold until N consecutive non-veto passes.
 */
import type { CortexVerdict } from "@/lib/nighthawk/cortex";
import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";
import type { ZeroDteCortexAssessment } from "./cortex-gate";

export const CORTEX_VETO_DWELL_DEFAULT_PASSES = 3;
const DWELL_TTL_SEC = 24 * 60 * 60;

export type CortexVetoDwellState = {
  latched: boolean;
  latched_at: string;
  /** Verdict snapshot from the pass that latched the veto. */
  latched_verdict: CortexVerdict | null;
  passes_since_clear: number;
  last_fresh_decision: string;
};

function dwellKey(sessionDate: string, ticker: string): string {
  return `zerodte:cortex:veto-dwell:${sessionDate}:${ticker.toUpperCase()}`;
}

export function cortexVetoDwellPasses(): number {
  const raw = process.env.ZERODTE_CORTEX_VETO_DWELL_PASSES?.trim();
  if (raw === "0" || raw === "off" || raw === "false") return 0;
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  return CORTEX_VETO_DWELL_DEFAULT_PASSES;
}

function latchedAssessment(verdict: CortexVerdict): ZeroDteCortexAssessment {
  return { decision: "VETO", abstained: false, verdict };
}

/** Pure fold: given prior dwell state + fresh assessment, return effective assessment + next state. */
export function applyCortexVetoDwellPure(
  fresh: ZeroDteCortexAssessment,
  prior: CortexVetoDwellState | null,
  clearPasses: number
): { assessment: ZeroDteCortexAssessment; next: CortexVetoDwellState | null } {
  const nowIso = new Date().toISOString();

  if (fresh.decision === "VETO" && !fresh.abstained) {
    return {
      assessment: fresh,
      next: {
        latched: true,
        latched_at: nowIso,
        latched_verdict: fresh.verdict,
        passes_since_clear: 0,
        last_fresh_decision: fresh.decision,
      },
    };
  }

  if (clearPasses <= 0 || !prior?.latched || !prior.latched_verdict) {
    return {
      assessment: fresh,
      next: prior
        ? {
            ...prior,
            latched: false,
            passes_since_clear: 0,
            last_fresh_decision: fresh.decision,
          }
        : null,
    };
  }

  const passes = prior.passes_since_clear + 1;
  if (passes < clearPasses) {
    return {
      assessment: latchedAssessment(prior.latched_verdict),
      next: {
        ...prior,
        passes_since_clear: passes,
        last_fresh_decision: fresh.decision,
      },
    };
  }

  return {
    assessment: fresh,
    next: {
      latched: false,
      latched_at: nowIso,
      latched_verdict: null,
      passes_since_clear: 0,
      last_fresh_decision: fresh.decision,
    },
  };
}

export async function loadCortexVetoDwellState(
  sessionDate: string,
  ticker: string
): Promise<CortexVetoDwellState | null> {
  return sharedCacheGet<CortexVetoDwellState>(dwellKey(sessionDate, ticker));
}

export async function saveCortexVetoDwellState(
  sessionDate: string,
  ticker: string,
  state: CortexVetoDwellState | null
): Promise<void> {
  if (!state?.latched) {
    await sharedCacheSet(dwellKey(sessionDate, ticker), state, 60);
    return;
  }
  await sharedCacheSet(dwellKey(sessionDate, ticker), state, DWELL_TTL_SEC);
}

/** Async wrapper — no-op when clearPasses is 0. */
export async function applyCortexVetoDwell(
  sessionDate: string,
  ticker: string,
  fresh: ZeroDteCortexAssessment
): Promise<ZeroDteCortexAssessment> {
  const clearPasses = cortexVetoDwellPasses();
  if (clearPasses <= 0) return fresh;

  const prior = await loadCortexVetoDwellState(sessionDate, ticker);
  const { assessment, next } = applyCortexVetoDwellPure(fresh, prior, clearPasses);
  await saveCortexVetoDwellState(sessionDate, ticker, next);
  return assessment;
}
