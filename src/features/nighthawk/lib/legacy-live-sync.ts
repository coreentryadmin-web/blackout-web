/**
 * Legacy live-sync — mark-and-manage open Night Hawk playbook positions for the Chief Trade Alert Bot.
 *
 * Two exit models:
 *   - scale_out (bangers): shared deriveScaleOutAction state machine (same as banger-live-sync)
 *   - plan (default): premium −50% hard stop, +100% trim latch, stock stop → STC, stock target → trim
 *
 * Fire-and-forget Discord hooks; DB state latched via updateLegacyDiscordLiveState.
 */
import type { LegacyDiscordLiveRow } from "@/lib/db";
import { deriveScaleOutAction, SCALE_OUT_RULES, type ScaleOutAction } from "@/lib/zerodte/scale-out";
import { PLAN_RULES } from "@/lib/zerodte/plan";
import {
  ensureLegacyDiscordBtos,
  legacyDiscordAlertsEnabled,
  legacyInputFromOutcomeRow,
} from "./legacy-discord-trade-notify";

export type LegacyLiveSyncRow = LegacyDiscordLiveRow & {
  peak_premium: number | null;
  trough_premium: number | null;
  trims_taken: number;
  scaled_already: boolean;
};

export type LegacyLiveSyncDeps = {
  fetchOpenRows: () => Promise<LegacyLiveSyncRow[]>;
  fetchOptionMarks: (occs: string[]) => Promise<Map<string, number>>;
  fetchStockPrices: (tickers: string[]) => Promise<Map<string, number>>;
  updateLiveState: (
    id: number,
    update: {
      closed?: boolean;
      closedReason?: string | null;
      btoPosted?: boolean;
      mark?: number | null;
      peakPremium?: number | null;
      troughPremium?: number | null;
      trimsTaken?: number | null;
      scaledNow?: boolean;
      lastAction?: string | null;
    }
  ) => Promise<void>;
  notifyTrim?: (row: LegacyLiveSyncRow, trimIndex: number, price: number) => Promise<void>;
  notifyTrimLatch?: (row: LegacyLiveSyncRow, price: number) => Promise<void>;
  notifyClose?: (row: LegacyLiveSyncRow, price: number, reason: string) => Promise<void>;
  env?: NodeJS.ProcessEnv;
};

export type LegacyLiveSyncResult = {
  ok: boolean;
  skipped: boolean;
  reason?: string;
  rows: number;
  refreshed: number;
  noQuote: number;
  bto_posted?: number;
  bto_skipped?: number;
  transitions: Array<{ id: number; ticker: string; action: string }>;
};

function readLiveState(row: LegacyDiscordLiveRow): {
  peak_premium: number | null;
  trough_premium: number | null;
  trims_taken: number;
  scaled_already: boolean;
} {
  const s = row.discord_live_state;
  return {
    peak_premium: s?.peak_premium ?? null,
    trough_premium: s?.trough_premium ?? null,
    trims_taken: s?.trims_taken ?? 0,
    scaled_already: Boolean(s?.scaled_already),
  };
}

export function hydrateLegacyLiveSyncRow(row: LegacyDiscordLiveRow): LegacyLiveSyncRow {
  const live = readLiveState(row);
  return { ...row, ...live };
}

function premiumStopPrice(entry: number): number {
  return entry * (1 + PLAN_RULES.stop_pct / 100);
}

function premiumTargetPrice(entry: number): number {
  return entry * (1 + PLAN_RULES.target_pct / 100);
}

type LegacyStockBands = Pick<LegacyLiveSyncRow, "direction" | "target" | "stop">;

function stockAtStop(row: LegacyStockBands, price: number): boolean {
  if (row.stop == null) return false;
  return row.direction === "LONG" ? price <= row.stop : price >= row.stop;
}

function stockAtTarget(row: LegacyStockBands, price: number): boolean {
  if (row.target == null) return false;
  return row.direction === "LONG" ? price >= row.target : price <= row.target;
}

export type LegacyPlanAction =
  | { kind: "HOLD"; reason: string }
  | { kind: "CLOSE"; reason: string }
  | { kind: "TRIM"; reason: string; trimIndex: number };

/** Plan-model management on option mark + underlying stop/target. */
export function deriveLegacyPlanAction(input: {
  row: Pick<LegacyLiveSyncRow, "entry_premium" | "direction" | "target" | "stop" | "trims_taken">;
  mark: number;
  stockPrice?: number | null;
}): LegacyPlanAction {
  const { row, mark, stockPrice } = input;
  const entry = row.entry_premium;
  if (!(entry > 0) || !Number.isFinite(mark)) {
    return { kind: "HOLD", reason: "no usable entry/mark" };
  }

  if (mark <= premiumStopPrice(entry)) {
    return { kind: "CLOSE", reason: `premium ≤ ${PLAN_RULES.stop_pct}% stop` };
  }
  if (stockPrice != null && Number.isFinite(stockPrice) && stockAtStop(row, stockPrice)) {
    return { kind: "CLOSE", reason: "underlying at plan stop" };
  }
  if (mark >= premiumTargetPrice(entry) && row.trims_taken === 0) {
    return { kind: "TRIM", reason: `premium ≥ +${PLAN_RULES.target_pct}% — bank trim`, trimIndex: 1 };
  }
  if (stockPrice != null && Number.isFinite(stockPrice) && stockAtTarget(row, stockPrice) && row.trims_taken === 0) {
    return { kind: "TRIM", reason: "underlying at plan target — bank trim", trimIndex: 1 };
  }
  return { kind: "HOLD", reason: "within plan bands" };
}

export async function runLegacyLiveSync(deps: LegacyLiveSyncDeps): Promise<LegacyLiveSyncResult> {
  const env = deps.env ?? process.env;
  if (!legacyDiscordAlertsEnabled()) {
    return {
      ok: true,
      skipped: true,
      reason: "LEGACY_DISCORD_ALERTS=0 — live management off",
      rows: 0,
      refreshed: 0,
      noQuote: 0,
      transitions: [],
    };
  }

  const rows = await deps.fetchOpenRows();
  if (rows.length === 0) {
    return { ok: true, skipped: false, rows: 0, refreshed: 0, noQuote: 0, transitions: [] };
  }

  const bto = await ensureLegacyDiscordBtos(
    rows,
    (row) => legacyInputFromOutcomeRow(row),
    (row) =>
      deps.updateLiveState(row.id, {
        btoPosted: true,
        mark: row.entry_premium,
        peakPremium: row.peak_premium ?? row.entry_premium,
        troughPremium: row.trough_premium ?? row.entry_premium,
        lastAction: "BTO",
      })
  );
  if (bto.bto_posted > 0) {
    console.info(`[legacy-live-sync] posted ${bto.bto_posted} missing BTO(s), skipped ${bto.bto_skipped}`);
  }

  const occs = [...new Set(rows.map((r) => r.contract_occ))];
  const tickers = [...new Set(rows.map((r) => r.ticker))];
  const [marks, stocks] = await Promise.all([
    deps.fetchOptionMarks(occs),
    deps.fetchStockPrices(tickers),
  ]);

  let refreshed = 0;
  let noQuote = 0;
  const transitions: Array<{ id: number; ticker: string; action: string }> = [];

  for (const row of rows) {
    const mark = marks.get(row.contract_occ);
    if (mark == null || !Number.isFinite(mark) || mark <= 0) {
      noQuote += 1;
      continue;
    }
    refreshed += 1;
    const stockPrice = stocks.get(row.ticker.toUpperCase()) ?? null;
    const peak = row.peak_premium ?? row.entry_premium;
    const peakOut = Math.max(peak, mark);
    const troughOut =
      row.trough_premium != null ? Math.min(row.trough_premium, mark) : mark;

    if (row.exit_style === "scale_out") {
      const { action, reason } = deriveScaleOutAction({
        entryPremium: row.entry_premium,
        peakPremium: peakOut,
        lastMark: mark,
        scaledAlready: row.scaled_already,
      });
      await handleScaleOutAction(deps, row, mark, peakOut, troughOut, action, reason, transitions);
      continue;
    }

    const plan = deriveLegacyPlanAction({ row, mark, stockPrice });
    if (plan.kind === "HOLD") {
      await deps.updateLiveState(row.id, {
        mark,
        peakPremium: peakOut,
        troughPremium: troughOut,
        lastAction: "HOLD",
      });
      continue;
    }
    if (plan.kind === "TRIM") {
      await deps.updateLiveState(row.id, {
        mark,
        peakPremium: peakOut,
        troughPremium: troughOut,
        trimsTaken: plan.trimIndex,
        lastAction: `TRIM:${plan.trimIndex}`,
      });
      if (deps.notifyTrimLatch) {
        await deps.notifyTrimLatch(row, mark).catch(() => undefined);
      }
      transitions.push({ id: row.id, ticker: row.ticker, action: "TRIM" });
      continue;
    }

    await deps.updateLiveState(row.id, {
      closed: true,
      closedReason: plan.reason,
      mark,
      peakPremium: peakOut,
      troughPremium: troughOut,
      lastAction: "CLOSE",
    });
    if (deps.notifyClose) {
      await deps.notifyClose(row, mark, plan.reason).catch(() => undefined);
    }
    transitions.push({ id: row.id, ticker: row.ticker, action: "CLOSE" });
  }

  return {
    ok: true,
    skipped: false,
    rows: rows.length,
    refreshed,
    noQuote,
    bto_posted: bto.bto_posted,
    bto_skipped: bto.bto_skipped,
    transitions,
  };
}

async function handleScaleOutAction(
  deps: LegacyLiveSyncDeps,
  row: LegacyLiveSyncRow,
  mark: number,
  peakOut: number,
  troughOut: number,
  action: ScaleOutAction,
  reason: string,
  transitions: Array<{ id: number; ticker: string; action: string }>
): Promise<void> {
  if (action === "HOLD") {
    await deps.updateLiveState(row.id, {
      mark,
      peakPremium: peakOut,
      troughPremium: troughOut,
      lastAction: "HOLD",
    });
    return;
  }

  if (action === "TAKE_PARTIAL") {
    const trimsTaken = Math.max(row.trims_taken, 1);
    await deps.updateLiveState(row.id, {
      mark,
      peakPremium: peakOut,
      troughPremium: troughOut,
      scaledNow: true,
      trimsTaken,
      lastAction: "TAKE_PARTIAL",
    });
    if (deps.notifyTrim) {
      await deps.notifyTrim(row, trimsTaken, mark).catch(() => undefined);
    }
    transitions.push({ id: row.id, ticker: row.ticker, action: "TAKE_PARTIAL" });
    return;
  }

  const closeReason =
    action === "STOP_OUT"
      ? reason
      : action === "EXIT_RUNNER"
        ? reason
        : reason;
  await deps.updateLiveState(row.id, {
    closed: true,
    closedReason: closeReason,
    mark: action === "STOP_OUT" ? row.entry_premium * SCALE_OUT_RULES.hard_stop_mult : mark,
    peakPremium: peakOut,
    troughPremium: troughOut,
    lastAction: action,
  });
  const exitPrice = action === "STOP_OUT" ? row.entry_premium * SCALE_OUT_RULES.hard_stop_mult : mark;
  if (deps.notifyClose) {
    await deps.notifyClose(row, exitPrice, closeReason).catch(() => undefined);
  }
  transitions.push({ id: row.id, ticker: row.ticker, action });
}
