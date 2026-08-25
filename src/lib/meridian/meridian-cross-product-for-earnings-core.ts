import type { SpxSlayerBadge } from "@/features/spx/lib/spx-slayer-badge-map";
import type { GexWall } from "@/lib/providers/gamma-desk";
import type { ZeroDteBoardPayload } from "@/lib/platform/zerodte-service";
import type { SpxDeskSummary } from "@/lib/platform/types";
import type {
  MeridianEarningsNighthawkRead,
  MeridianEarningsSpxRead,
} from "@/features/meridian/lib/meridian-types";
import { fmtPremium } from "@/lib/fmt-money";

function num(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

export function isMeridianSpxEarningsTicker(ticker: string | null | undefined): boolean {
  const t = String(ticker ?? "")
    .trim()
    .toUpperCase();
  return t === "SPX" || t === "SPXW";
}

function fmtStrike(strike: number): string {
  return Number.isInteger(strike) ? String(strike) : strike.toFixed(1);
}

function topGexWalls(walls: unknown): { call: number | null; put: number | null } {
  if (!Array.isArray(walls)) return { call: null, put: null };
  let call: number | null = null;
  let put: number | null = null;
  for (const row of walls as GexWall[]) {
    const strike = num(row?.strike);
    if (strike == null) continue;
    if (row.kind === "resistance" && call == null) call = strike;
    if (row.kind === "support" && put == null) put = strike;
  }
  return { call, put };
}

/** Map today's Night Hawk board snapshot → Meridian inline card for one ticker. */
export function shapeMeridianNighthawkBoardRead(input: {
  ticker: string;
  board: ZeroDteBoardPayload | null | undefined;
}): MeridianEarningsNighthawkRead {
  const sym = input.ticker.trim().toUpperCase();
  const board = input.board;
  if (!board?.available || !sym) {
    return {
      available: false,
      on_board: false,
      lane: null,
      direction: null,
      strike: null,
      expiry: null,
      score: null,
      conviction: null,
      status: null,
      headline: null,
      live_pnl_pct: null,
      session_label: null,
    };
  }

  const ledger = (board.ledger ?? []).find((r) => r.ticker.trim().toUpperCase() === sym);
  if (ledger) {
    const direction = ledger.direction === "long" || ledger.direction === "short" ? ledger.direction : null;
    const side = direction === "long" ? "call" : direction === "short" ? "put" : null;
    const strike = num(ledger.top_strike);
    const contract =
      strike != null && side
        ? `${sym} ${fmtStrike(strike)}${side === "call" ? "C" : "P"}`
        : null;
    const status = ledger.status?.trim() || null;
    const headline =
      contract && status
        ? `${contract} · ${status}`
        : contract ?? (status ? `${sym} · ${status}` : `${sym} on today's board`);

    return {
      available: true,
      on_board: true,
      lane: "ledger",
      direction,
      strike,
      expiry: ledger.expiry ?? null,
      score: num(ledger.score_max),
      conviction: ledger.conviction ?? null,
      status,
      headline,
      live_pnl_pct: num(ledger.live_pnl_pct),
      session_label: board.session?.heat?.label ?? null,
    };
  }

  const setup = (board.setups ?? []).find((s) => s.ticker.trim().toUpperCase() === sym);
  if (setup) {
    const direction = setup.direction === "long" || setup.direction === "short" ? setup.direction : null;
    const side = direction === "long" ? "call" : direction === "short" ? "put" : null;
    const strike = num(setup.top_strike);
    const contract =
      strike != null && side ? `${sym} ${fmtStrike(strike)}${side === "call" ? "C" : "P"}` : null;
    const status = "candidate";
    const headline = contract ? `${contract} · ${status}` : `${sym} · ${status}`;

    return {
      available: true,
      on_board: true,
      lane: "setup",
      direction,
      strike,
      expiry: setup.expiry ?? null,
      score: num(setup.dossier_score ?? setup.score),
      conviction: setup.conviction ?? null,
      status,
      headline,
      live_pnl_pct: null,
      session_label: board.session?.heat?.label ?? null,
    };
  }

  return {
    available: false,
    on_board: false,
    lane: null,
    direction: null,
    strike: null,
    expiry: null,
    score: null,
    conviction: null,
    status: null,
    headline: null,
    live_pnl_pct: null,
    session_label: board.session?.heat?.label ?? null,
  };
}

/** Map SPX desk summary + play badge → Meridian inline card (SPX/SPXW earnings only). */
export function shapeMeridianSpxDeskRead(input: {
  summary: SpxDeskSummary | null | undefined;
  playBadge: SpxSlayerBadge | null | undefined;
}): MeridianEarningsSpxRead {
  const summary = input.summary;
  const badge = input.playBadge;
  const walls = topGexWalls(summary?.gex_walls);
  const stacks = (summary?.strike_stacks ?? []).slice(0, 4).map((s) => ({
    strike: num(s.strike),
    premium_label: fmtPremium(s.total_premium),
    hit_count: num(s.alert_count) ?? 0,
  }));

  const hasDesk =
    summary != null &&
    (num(summary.price) != null ||
      summary.gamma_regime != null ||
      walls.call != null ||
      walls.put != null ||
      stacks.length > 0);
  const hasPlay = badge?.available === true;

  if (!hasDesk && !hasPlay) {
    return {
      available: false,
      price: null,
      change_pct: null,
      gamma_regime: null,
      gamma_flip: null,
      gex_king: null,
      call_wall: null,
      put_wall: null,
      tide_bias: null,
      flow_0dte_net: null,
      play_phase: null,
      play_action: null,
      play_grade: null,
      play_headline: null,
      strike_stacks: [],
    };
  }

  return {
    available: true,
    price: num(summary?.price),
    change_pct: num(summary?.change_pct),
    gamma_regime: summary?.gamma_regime ?? null,
    gamma_flip: num(summary?.gamma_flip),
    gex_king: num(summary?.gex_king),
    call_wall: walls.call,
    put_wall: walls.put,
    tide_bias: summary?.tide_bias ?? null,
    flow_0dte_net: num(summary?.flow_0dte_net),
    play_phase: badge?.phase ?? null,
    play_action: badge?.action ?? null,
    play_grade: badge?.grade ?? null,
    play_headline: badge?.headline ?? null,
    strike_stacks: stacks.filter((s) => s.strike != null),
  };
}
