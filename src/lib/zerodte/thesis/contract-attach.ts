import type { EnrichedZeroDteSetup } from "../board";
import { deriveContractHorizon, gradingPolicyForHorizon } from "../board";
import { buildOcc } from "@/lib/ws/options-socket";
import { fetchOptionsUnifiedSnapshot } from "@/lib/providers/options-snapshot";
import { nextTradingDayEt, todayEt } from "@/features/nighthawk/lib/session";
import {
  chainRowsToCandidates,
  pickBestExpression,
  rankContractsForThesis,
} from "./contract-engine";
import type { ContractCandidateInput } from "./types";
import { thesisFirstEnv } from "./types";

function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      }
    );
  });
}

/** Strike ladder around spot for cross-DTE contract scan. */
export function strikesAroundSpot(spot: number, count = 5): number[] {
  if (!Number.isFinite(spot) || spot <= 0) return [];
  const step = spot >= 200 ? 2.5 : spot >= 50 ? 1 : 0.5;
  const atm = Math.round(spot / step) * step;
  const out: number[] = [];
  for (let i = -Math.floor(count / 2); i <= Math.floor(count / 2); i++) {
    out.push(Math.round((atm + i * step) * 100) / 100);
  }
  return [...new Set(out)];
}

export function expiriesForContractScan(today: string, maxDays = 5): string[] {
  const out = [today];
  let d = today;
  while (out.length < maxDays) {
    d = nextTradingDayEt(d);
    if (out.includes(d)) break;
    out.push(d);
  }
  return out;
}

function dteFrom(today: string, expiry: string): number {
  const a = Date.parse(`${today}T12:00:00Z`);
  const b = Date.parse(`${expiry}T12:00:00Z`);
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** Apply contract engine picks for thesis-first COMMIT survivors (live path). */
export async function attachThesisContractPlans(setups: EnrichedZeroDteSetup[]): Promise<void> {
  if (!thesisFirstEnv().enabled) return;

  const today = todayEt();
  const occMeta: Array<{ setup: EnrichedZeroDteSetup; occ: string; expiry: string; strike: number }> =
    [];

  for (const s of setups) {
    if (s.play_type === "CONDOR") continue;
    if (s.gate?.verdict !== "COMMIT") continue;
    if (!s.thesis_first?.thesis) continue;
    const spot = s.underlying_price;
    if (spot == null || !Number.isFinite(spot)) continue;

    const side = s.direction === "long" ? "call" : "put";
    const expiries = expiriesForContractScan(today, 5);
    const strikes = strikesAroundSpot(spot, 5);

    for (const expiry of expiries) {
      for (const strike of strikes) {
        const occ = buildOcc(s.ticker, expiry, side, strike);
        if (occ) occMeta.push({ setup: s, occ, expiry, strike });
      }
    }
  }

  if (occMeta.length === 0) return;

  const snaps = await within(
    fetchOptionsUnifiedSnapshot(occMeta.map((m) => m.occ)).catch(() => new Map()),
    6_000
  );
  if (!snaps) return;

  const byTicker = new Map<string, ContractCandidateInput[]>();

  for (const m of occMeta) {
    const snap = snaps.get(m.occ);
    if (!snap) continue;
    const side = m.setup.direction === "long" ? "call" : "put";
    const row: ContractCandidateInput = {
      expiry: m.expiry,
      strike: m.strike,
      dte: dteFrom(today, m.expiry),
      side,
      bid: snap.bid ?? null,
      ask: snap.ask ?? null,
      oi: snap.openInterest ?? 0,
    };
    const arr = byTicker.get(m.setup.ticker) ?? [];
    arr.push(row);
    byTicker.set(m.setup.ticker, arr);
  }

  for (const s of setups) {
    const chain = byTicker.get(s.ticker);
    if (!chain?.length || !s.thesis_first?.thesis) continue;
    if (s.gate?.verdict !== "COMMIT") continue;

    const spot = s.underlying_price ?? 0;
    const ivGuess =
      s.condor?.est_win_rate != null ? null : s.rsi14 != null && s.rel_volume != null && s.rel_volume > 2 ? 82 : null;

    const expression = pickBestExpression({
      thesis: s.thesis_first.thesis,
      chain,
      spot,
      iv_rank_0dte: ivGuess,
    });

    s.thesis_first = { ...s.thesis_first, expression };

    const best = expression.contract;
    if (best) {
      s.top_strike = best.strike;
      s.expiry = best.expiry;
      s.contract_horizon = deriveContractHorizon(best.dte);
      s.actual_dte_at_commit = best.dte;
      s.grading_policy = gradingPolicyForHorizon(s.contract_horizon);
    }
  }
}

export { rankContractsForThesis, pickBestExpression };
