/**
 * SWING THESIS HEALTH — multi-day pillars for OPEN swing positions.
 *
 * Compares frozen commit context (setup maturity, entry geometry, signal corroboration) against
 * live reads (manage action, thesis break, premium P&L, DTE budget). Produces the same
 * ThesisHealthPayload shape as 0DTE so the command panel can share render primitives.
 *
 * PURE — no IO. Board adapter stamps on build; client overlay refreshes computedAtEt @ 1 Hz.
 */

import type { ThesisHealthPayload, ThesisPillarState, ThesisPillarId } from "@/lib/zerodte/thesis-health";
import type { SwingManageAction } from "./manage";
import type { SwingServingSection } from "./serving";
import type { SwingSetupState, SwingEntryState } from "./taxonomy";
import type { DeckDirection, DeckStatus, ThesisLevel } from "@/features/nighthawk/command-deck/types";
import type { DeckFactor } from "@/features/nighthawk/command-deck/types";
import { SWING_SUBLANE_MANAGE } from "./manage";
import type { SwingSubLane } from "./taxonomy";

export type SwingThesisPillarId =
  | "persistence"
  | "entry_geometry"
  | "flow_corroboration"
  | "regime"
  | "theta_budget";

const PILLAR_LABELS: Record<SwingThesisPillarId, string> = {
  persistence: "Persistence",
  entry_geometry: "Entry geometry",
  flow_corroboration: "Signal stack",
  regime: "Regime fit",
  theta_budget: "Theta budget",
};

/** Map swing pillar ids onto the shared ThesisHealthPayload vocabulary (panel is id-agnostic). */
const PILLAR_ID_MAP: Record<SwingThesisPillarId, ThesisPillarId> = {
  persistence: "structure",
  entry_geometry: "momentum",
  flow_corroboration: "flow",
  regime: "market",
  theta_budget: "volatility",
};

/** Default pillar labels when commit-time inputs (setupState/entryStatus/signalKinds) are not wired. */
const UNCALIBRATED_PILLAR_LABELS: Partial<Record<SwingThesisPillarId, string>> = {
  persistence: "unknown",
  entry_geometry: "n/a",
  flow_corroboration: "no signals",
};

/** True when the aggregate health % is built from generic defaults — not a calibrated read. */
export function thesisHealthUncalibrated(h: ThesisHealthPayload | null | undefined): boolean {
  if (!h?.pillars?.length) return false;
  for (const [id, defaultLabel] of Object.entries(UNCALIBRATED_PILLAR_LABELS) as Array<
    [SwingThesisPillarId, string]
  >) {
    const mappedId = PILLAR_ID_MAP[id];
    const pillar = h.pillars.find((p) => p.id === mappedId);
    if (pillar?.currentLabel === defaultLabel) return true;
  }
  return false;
}

const DEFAULT_WEIGHTS: Record<SwingThesisPillarId, number> = {
  persistence: 0.28,
  entry_geometry: 0.22,
  flow_corroboration: 0.2,
  regime: 0.15,
  theta_budget: 0.15,
};

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function setupPersistenceScore(state: SwingSetupState | null | undefined): { commit: number; current: number; label: string } {
  switch (state) {
    case "EXTENDED":
      return { commit: 1, current: 1, label: "extended" };
    case "TRIGGERED":
      return { commit: 0.9, current: 0.9, label: "triggered" };
    case "FORMING":
      return { commit: 0.55, current: 0.55, label: "forming" };
    case "INVALIDATED":
      return { commit: 0.2, current: 0, label: "invalidated" };
    default:
      return { commit: 0.4, current: 0.35, label: "unknown" };
  }
}

function entryGeometryScore(status: SwingEntryState | null | undefined): { commit: number; current: number; label: string } {
  switch (status) {
    case "AT_TRIGGER":
      return { commit: 1, current: 1, label: "at trigger" };
    case "PULLBACK_TO_ENTRY":
      return { commit: 0.85, current: 0.85, label: "pullback" };
    case "PRE_TRIGGER":
      return { commit: 0.6, current: 0.6, label: "pre-trigger" };
    case "EXTENDED_CHASE":
      return { commit: 0.35, current: 0.35, label: "chase risk" };
    default:
      return { commit: 0.5, current: 0.45, label: "n/a" };
  }
}

function signalScore(kinds: string[] | null | undefined): { commit: number; current: number; label: string } {
  const set = new Set((kinds ?? []).map((k) => k.toUpperCase()));
  const count = set.size;
  const hasVector = set.has("VECTOR");
  const hasBanger = set.has("BANGER");
  const hasFlow = set.has("FLOW");
  let score = 0.35;
  if (hasFlow) score += 0.25;
  if (hasVector) score += 0.2;
  if (hasBanger) score += 0.15;
  if (count >= 3) score += 0.05;
  score = clamp01(score);
  const label = count === 0 ? "no signals" : [...set].slice(0, 3).join("+");
  return { commit: score, current: score, label };
}

function regimeScore(regime: string | null | undefined, factors: DeckFactor[] | undefined): { commit: number; current: number; label: string } {
  const top = factors?.[0];
  const base = regime ? 0.75 : 0.45;
  const factorBoost = top && top.points > 0 ? Math.min(0.2, top.points / 100) : 0;
  const score = clamp01(base + factorBoost);
  return { commit: score, current: score, label: regime ?? (top ? top.label : "unread") };
}

function thetaBudgetScore(dte: number | null | undefined, subLane: string | null | undefined): { commit: number; current: number; label: string } {
  if (dte == null || !Number.isFinite(dte)) {
    return { commit: 0.5, current: 0.4, label: "DTE n/a" };
  }
  const lane = (subLane as SwingSubLane | null) ?? null;
  const spec = lane ? SWING_SUBLANE_MANAGE[lane] : null;
  const cliff = spec?.expiryRiskDte ?? 2;
  if (dte <= cliff) return { commit: 0.7, current: 0.15, label: `DTE ${dte} cliff` };
  if (dte <= (spec?.migrationDte ?? 4)) return { commit: 0.75, current: 0.55, label: `DTE ${dte} migrate` };
  return { commit: 0.85, current: 0.85, label: `${dte}DTE runway` };
}

function toPillarPair(row: { commit: number; current: number; label: string }): {
  commit: { score: number; label: string };
  current: { score: number; label: string };
} {
  return {
    commit: { score: row.commit, label: row.label },
    current: { score: row.current, label: row.label },
  };
}

function pillarStatus(commit: number, current: number): ThesisPillarState["status"] {
  if (current >= commit - 0.05) return current > commit + 0.05 ? "strengthened" : "intact";
  if (current >= commit - 0.2) return "faded";
  return "lost";
}

function rungFromHealth(health: number): ThesisHealthPayload["rung"] {
  if (health >= 85) return "INTACT";
  if (health >= 70) return "MINOR";
  if (health >= 55) return "WEAKENING";
  if (health >= 35) return "DEGRADED";
  if (health >= 15) return "BROKEN";
  return "OPPOSITE";
}

function rungLabel(rung: ThesisHealthPayload["rung"]): string {
  const map: Record<ThesisHealthPayload["rung"], string> = {
    INTACT: "Intact",
    MINOR: "Minor drift",
    WEAKENING: "Weakening",
    DEGRADED: "Degraded",
    BROKEN: "Broken",
    OPPOSITE: "Opposite",
  };
  return map[rung];
}

function thesisBreakFromHealth(
  health: number,
  thesisBreak: { level: ThesisLevel; note?: string } | null | undefined,
  moves: string[],
): { level: ThesisLevel; note: string } {
  if (thesisBreak?.level === "break") {
    return { level: "break", note: thesisBreak.note ?? "thesis broken" };
  }
  if (thesisBreak?.level === "warn") {
    return { level: "warn", note: thesisBreak.note ?? "thesis warning" };
  }
  if (health >= 70) return { level: "intact", note: moves[0] ?? "multi-day thesis intact" };
  if (health >= 45) return { level: "warn", note: moves[0] ?? "pillars fading" };
  if (health >= 0) return { level: "break", note: moves[0] ?? "thesis no longer matches entry" };
  return { level: "unknown", note: "insufficient swing context" };
}

function degradeFromManage(
  action: SwingManageAction | null | undefined,
  pillars: ThesisPillarState[],
): void {
  if (!action || action === "HOLD" || action === "ADD") return;
  const target = pillars.find((p) => p.label === PILLAR_LABELS.persistence);
  if (!target) return;
  if (action === "EXIT" || action === "STOP_OUT") {
    target.currentScore = 0;
    target.status = "lost";
    target.currentLabel = "exit signal";
  } else if (action === "TAKE_PARTIAL" || action === "EXIT_RUNNER") {
    target.currentScore = Math.min(target.currentScore, 0.55);
    target.status = "faded";
    target.currentLabel = "scale-out";
  }
}

export interface SwingThesisHealthInput {
  direction: DeckDirection;
  status: DeckStatus;
  setupState?: SwingSetupState | null;
  entryStatus?: SwingEntryState | null;
  factors?: DeckFactor[];
  regime?: string | null;
  signalKinds?: string[] | null;
  thesisBreak?: { level: ThesisLevel; note?: string } | null;
  servingSection?: SwingServingSection | null;
  manageAction?: SwingManageAction | null;
  pnlPct?: number | null;
  dte?: number | null;
  subLane?: string | null;
  committedAtEt?: string | null;
  computedAtEt: string;
}

/** Compute swing thesis health for working rows; null for candidates / missing context. */
export function computeSwingThesisHealth(input: SwingThesisHealthInput): ThesisHealthPayload | null {
  const st = String(input.status ?? "").toUpperCase();
  if (!["OPEN", "HOLD", "TRIM"].includes(st)) return null;

  const persistence = setupPersistenceScore(input.setupState);
  const entry = entryGeometryScore(input.entryStatus);
  const signals = signalScore(input.signalKinds);
  const regime = regimeScore(input.regime, input.factors);
  const theta = thetaBudgetScore(input.dte, input.subLane);

  if (input.thesisBreak?.level === "break") {
    persistence.current = 0;
  } else if (input.thesisBreak?.level === "warn") {
    persistence.current = Math.min(persistence.current, 0.45);
  }

  const defs: Array<{
    id: SwingThesisPillarId;
    commit: { score: number; label: string };
    current: { score: number; label: string };
  }> = [
    { id: "persistence", ...toPillarPair(persistence) },
    { id: "entry_geometry", ...toPillarPair(entry) },
    { id: "flow_corroboration", ...toPillarPair(signals) },
    { id: "regime", ...toPillarPair(regime) },
    { id: "theta_budget", ...toPillarPair(theta) },
  ];

  const pillars: ThesisPillarState[] = defs.map((d) => {
    const weight = DEFAULT_WEIGHTS[d.id];
    const status = pillarStatus(d.commit.score, d.current.score);
    const contributionPts = Math.round(weight * d.current.score * 100);
    const deltaPts = Math.round(weight * (d.current.score - d.commit.score) * 100);
    return {
      id: PILLAR_ID_MAP[d.id],
      label: PILLAR_LABELS[d.id],
      weight,
      commitScore: d.commit.score,
      currentScore: d.current.score,
      commitLabel: d.commit.label,
      currentLabel: d.current.label,
      status,
      contributionPts,
      deltaPts,
    };
  });

  degradeFromManage(input.manageAction, pillars);

  const health = Math.round(
    pillars.reduce((sum, p) => sum + p.weight * p.currentScore, 0) * 100,
  );
  const entryIndex = Math.round(
    defs.reduce((sum, d) => sum + DEFAULT_WEIGHTS[d.id] * d.commit.score, 0) * 100,
  );
  const currentIndex = health;
  const delta = currentIndex - entryIndex;
  const rung = rungFromHealth(health);

  const moves: string[] = [];
  for (const p of pillars) {
    if (p.status === "lost" || p.status === "faded") {
      moves.push(`${p.label}: ${p.commitLabel} → ${p.currentLabel}`);
    }
  }
  if (input.manageAction && input.manageAction !== "HOLD") {
    moves.unshift(`Manage engine: ${input.manageAction.replace("_", " ").toLowerCase()}`);
  }
  if (input.pnlPct != null && input.pnlPct <= -40) {
    moves.push(`Premium −${Math.abs(input.pnlPct).toFixed(0)}% — capital backstop zone`);
  }

  const br = thesisBreakFromHealth(health, input.thesisBreak, moves);
  const advisory =
    health >= 70
      ? "Hold while pillars hold — scale-out ladder governs profit-taking."
      : health >= 45
        ? "Thesis fading — tighten risk or trim into strength."
        : "Thesis broken or opposite — exit before premium catches up.";

  return {
    health,
    entryIndex,
    currentIndex,
    delta,
    rung,
    rungLabel: rungLabel(rung),
    pillars,
    moves: moves.length > 0 ? moves : ["All swing pillars unchanged since commit."],
    committedAtEt: input.committedAtEt ?? null,
    computedAtEt: input.computedAtEt,
    advisory,
    thesisBreakLevel: br.level,
    thesisBreakNote: br.note,
  };
}
