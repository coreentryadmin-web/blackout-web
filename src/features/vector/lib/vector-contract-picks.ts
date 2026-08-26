/**
 * VECTOR CONTRACT PICKS — turns the Suggested Play card's already-computed bias/conviction into
 * 1-2 real, liquid strike+expiry ideas ("230C 08/27") instead of leaving the member to translate
 * "SCALP · momentum long → target 7,700" into an actual contract themselves.
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
import type { VectorDteHorizon } from "./vector-dte-horizon";
import { horizonMaxDte } from "./vector-dte-horizon";

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
 * Directional legs to price for a play bias.
 *  - long/short: one clean directional idea → one leg.
 *  - range: the play already states BOTH entries in its own `entryZone` ("buy dips X / sell
 *    rips Y") — one play, two real entries, not two independently-scored ideas — so both legs
 *    get priced at the SAME conviction.
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
 * Build up to 2 real contract picks for a play against a ticker's real chain. Returns `[]`
 * rather than a placeholder when there's no play, no chain, or the bias has no directional leg
 * to price — the same "never fabricate, degrade to absent" rule every other Vector overlay
 * follows (`vector-play-engine.ts`'s own doc comments; `docs/audit/LARGO-PRODUCT-CONTRACT.md`).
 */
export function buildVectorContractPicks(
  play: { bias: VectorPlayBias; conviction: number } | null,
  chain: EditionChainData | null,
  horizon: VectorDteHorizon
): VectorContractPick[] {
  if (!play || !chain) return [];
  const maxDte = horizonMaxDte(horizon);
  const picks: VectorContractPick[] = [];
  for (const dir of legsForBias(play.bias)) {
    const contract = pickChainContract(chain, dir, maxDte);
    if (contract) picks.push(toVectorContractPick(contract, play.conviction));
  }
  return picks;
}
