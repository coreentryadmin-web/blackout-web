/**
 * VECTOR CONTRACT PICKS — turns the Suggested Play card's already-computed bias/conviction into
 * ONE real, liquid strike+expiry idea ("230C 08/27") instead of leaving the member to translate
 * "SCALP · momentum long → target 7,700" into an actual contract themselves. Always exactly one
 * pick (never two competing directions sharing one confidence number — see the "BUG FIXED" note
 * on `buildVectorContractPicks` below for why that was wrong) or zero when there's no clean
 * directional idea to price.
 *
 * DELIBERATELY REUSES, NEVER REINVENTS:
 *  - `pickChainContract` (Night Hawk's real, liquid, affordable strike picker) selects the
 *    contract — the same deterministic gates (OI floor, premium cap, relaxation ladder) Night
 *    Hawk publishes with. A member never sees a Vector-only picker disagree with Night Hawk's
 *    read of the same chain.
 *  - `play.conviction` IS the confidence shown here — never a second, separately-modeled
 *    probability. Per the Largo product contract's confidence rule, an invented score corrupts
 *    trust the moment it's compared against a real one; reusing the number already on the
 *    Suggested Play card means there is only ever ONE "how sure are we" per read.
 *
 * PURE by construction (no Date.now, no network) — the caller resolves the chain and passes it
 * in, exactly like `vector-play-engine.ts`'s own snapshot-in/play-out shape.
 */
import { pickChainContract } from "@/features/nighthawk/lib/deterministic-edition";
import type { EditionChainData } from "@/features/nighthawk/lib/option-chain-prompt";
import type { VectorPlayBias } from "./vector-play-engine";

type PickedContract = NonNullable<ReturnType<typeof pickChainContract>>;

export type VectorContractPick = {
  side: "call" | "put";
  strike: number;
  expiry: string;
  /** Compact desk label — "230C 08/27". */
  label: string;
  premium: number;
  /** 0-100 — literally `play.conviction`, not a separate model. See module doc. */
  confidence: number;
  caveat?: PickedContract["caveat"];
};

function formatStrike(strike: number): string {
  return Number.isInteger(strike) ? String(strike) : String(Number(strike.toFixed(2)));
}

/** ISO "2026-08-27" → "08/27" — compact enough for a rail row, unambiguous within one desk year. */
function expiryMmDd(iso: string): string {
  const parts = iso.split("-");
  if (parts.length < 3) return iso;
  return `${parts[1]}/${parts[2]}`;
}

function labelFor(contract: PickedContract): string {
  return `${formatStrike(contract.strike)}${contract.side === "call" ? "C" : "P"} ${expiryMmDd(contract.expiry)}`;
}

function toVectorContractPick(contract: PickedContract, confidence: number): VectorContractPick {
  return {
    side: contract.side,
    strike: contract.strike,
    expiry: contract.expiry,
    premium: contract.premium,
    caveat: contract.caveat,
    confidence,
    label: labelFor(contract),
  };
}

/**
 * Directional legs to FETCH a contract for, given a play bias. This is a candidate set, not the
 * final display set — `buildVectorContractPicks` below still collapses a `range` play's two
 * candidates down to one before returning (see that function's doc for why).
 *  - long/short: one clean directional idea → one leg.
 *  - range: both directions are candidates (whichever ends up nearer to spot wins — see below).
 *  - neutral: `stand-aside` AND `pivot` both collapse to this bias in `vector-play-engine.ts`
 *    (see `biasForSetup`), and there is no reliable way to tell them apart from `bias` alone.
 *    Rather than guess, this returns no legs for either — matching the card's own "no clean
 *    edge" honesty for stand-aside, and conservative (not wrong) for pivot.
 */
export function legsForBias(bias: VectorPlayBias): Array<"long" | "short"> {
  if (bias === "long") return ["long"];
  if (bias === "short") return ["short"];
  if (bias === "range") return ["long", "short"];
  return [];
}

/**
 * Build up to 1 real contract pick for a play against a ticker's real chain. Returns `[]` rather
 * than a placeholder when there's no play, no chain, or the bias has no directional leg to price
 * — the same "never fabricate, degrade to absent" rule every other Vector overlay follows
 * (`vector-play-engine.ts`'s own doc comments; `docs/audit/LARGO-PRODUCT-CONTRACT.md`).
 *
 * BUG FIXED (2026-08-26, live member report): a `range` play used to surface BOTH legs — a call
 * AND a put — each labeled with the play's own `conviction`, e.g. "577.5C 08/26 75%" next to
 * "565P 08/26 75%". A member correctly called this nonsensical: a call and a put cannot both have
 * a 75% chance of the SAME outcome, they're opposite bets. The `conviction` number describes the
 * PLAY (price is range-bound, fade extremes) — reusing it per-leg for two mutually exclusive
 * directions implied two independent, equal-odds bets that don't exist. Fix: a range play now
 * surfaces exactly ONE pick — whichever leg's strike sits closer to spot right now, i.e. the more
 * immediately actionable entry — so the confidence number reads as it should everywhere else: one
 * idea, one number.
 *
 * BUG FIXED (2026-08-26, live member report): this used to bound the search to
 * `horizonMaxDte(horizon)` — the chart's currently-selected DTE toggle (0DTE/Weekly/Monthly). A
 * member on the 0DTE view therefore always got a same-day contract even when the play itself had
 * nothing to do with 0DTE, which is how two picks both landed on "08/26" regardless of what the
 * play actually called for. The pick's expiry is not a chart-viewport setting — it should be
 * whichever real, liquid expiry `pickChainContract` finds best, independent of which DTE lens the
 * member happens to have the walls open to. `maxDte: null` is `pickChainContract`'s own
 * "swing window": nearest liquid expiry at least 2 calendar days out (falling back to a
 * short-dated pool only if nothing further out clears the liquidity/premium gates) — never same-
 * day, since a single real chart view has no bearing on whether a member is scalping or holding.
 */
export function buildVectorContractPicks(
  play: { bias: VectorPlayBias; conviction: number } | null,
  chain: EditionChainData | null
): VectorContractPick[] {
  if (!play || !chain) return [];
  const picks: VectorContractPick[] = [];
  for (const dir of legsForBias(play.bias)) {
    const contract = pickChainContract(chain, dir, null);
    if (contract) picks.push(toVectorContractPick(contract, play.conviction));
  }
  if (picks.length > 1 && chain.spot > 0) {
    picks.sort((a, b) => Math.abs(a.strike - chain.spot) - Math.abs(b.strike - chain.spot));
    return [picks[0]!];
  }
  return picks;
}
