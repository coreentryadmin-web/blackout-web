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

/**
 * Pick the DOMINANT call/put wall out of the SPX desk's `gex_walls` ladder.
 *
 * THE DEFECT THIS REPLACES. `gex_walls` ships from `topGexWalls` (gamma-desk.ts) sorted by
 * STRIKE DESCENDING — a display order, not a significance order — and that function's own doc
 * comment is explicit that `kind` is purely GEOMETRIC ("strike > spot -> resistance, else
 * support"), warning callers to derive the call/put wall from net_gex SIGN/magnitude, not from
 * `kind` alone ("the component derives the call/put wall label from net_gex SIGN... geometry !=
 * sign"). This function used to take the FIRST row of each kind in array order instead. Because
 * the array is strike-descending, that is the FARTHEST resistance strike (the highest strike
 * overall) paired with the NEAREST support strike (the highest strike among supports) — an
 * asymmetric mis-pick. The SPX gamma ladder is built from a guaranteed max-|net_gex| anchor on
 * each side PLUS several smaller proximity-fill strikes walked outward from spot — whenever the
 * real dominant call wall sits close to spot and a weaker fill strike extends farther out above
 * it, the old loop reported that farther, weaker decoy as the "call wall" to Meridian's SPX
 * earnings card (`Walls {put_wall} – {call_wall}`), understating how close dealers are actually
 * defending.
 *
 * THE FIX. Pick by the SAME definition used everywhere else this ladder's anchors are chosen
 * (gamma-desk.ts's own `topGexWalls`, `meridian-event-expiry-core.ts`'s `scopeStructureToExpiry`):
 * call wall = the resistance-kind strike with the largest POSITIVE net_gex; put wall = the
 * support-kind strike with the largest-magnitude NEGATIVE net_gex. Array order no longer matters.
 *
 * SIGN GUARD (found while re-verifying the fix above against the SAME reference it cites).
 * `kind` on a `GexWall` is purely GEOMETRIC (gamma-desk.ts's own doc comment: "strike > spot ->
 * resistance, else support" — NOT net_gex sign), and gamma-desk.ts's own secondary proximity-fill
 * pass adds "resistance"/"support" rows from EVERY strike above/below spot regardless of that
 * strike's net_gex sign ("walk OUT from spot on each side and take the nearest real strikes").
 * So on a deep negative-gamma day — the exact scenario gamma-desk.ts's own header calls out
 * ("on a negative-gamma day ... all puts") — every resistance-kind row in the ladder can have a
 * NEGATIVE net_gex, and the fix above (picking the max net_gex among resistance-kind rows with no
 * floor at zero) would still report the least-negative one as the "call wall" — inventing a call
 * wall at a strike that is actually dealer-SHORT gamma there, exactly what gamma-desk.ts's own
 * contract forbids ("If the chain genuinely has no positive-net_gex strike anywhere, NO call wall
 * is invented — the ladder is honestly put-only") and what the cited `scopeStructureToExpiry`
 * itself guards with its own explicit `v > 0`/`v < 0` checks. Requiring `netGex > 0` / `netGex < 0`
 * here (not just comparing kind-filtered rows against each other) closes that gap: a side with no
 * sign-correct strike anywhere in the ladder now honestly reports `null`, matching every other
 * wall-picker this function's own comment claims parity with.
 */
function topGexWalls(walls: unknown): { call: number | null; put: number | null } {
  if (!Array.isArray(walls)) return { call: null, put: null };
  let call: { strike: number; netGex: number } | null = null;
  let put: { strike: number; netGex: number } | null = null;
  for (const row of walls as GexWall[]) {
    const strike = num(row?.strike);
    const netGex = num(row?.net_gex);
    if (strike == null || netGex == null) continue;
    if (row.kind === "resistance" && netGex > 0 && (call == null || netGex > call.netGex)) {
      call = { strike, netGex };
    }
    if (row.kind === "support" && netGex < 0 && (put == null || netGex < put.netGex)) {
      put = { strike, netGex };
    }
  }
  return { call: call?.strike ?? null, put: put?.strike ?? null };
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
