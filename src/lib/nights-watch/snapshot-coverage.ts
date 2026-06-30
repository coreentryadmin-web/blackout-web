import type { UserPositionRow } from "@/lib/db";
import type { OptionSnapshot } from "@/lib/providers/options-snapshot";
import {
  valuationFromSnapshot,
  type LiveMark,
} from "@/lib/nights-watch/valuation";

/** True when a warmed unified snapshot already carries a usable valuation for this leg. */
export function snapshotMatchesPosition(
  position: Pick<UserPositionRow, "option_type" | "strike" | "expiry">,
  snap: OptionSnapshot | null | undefined
): boolean {
  return (
    snap != null &&
    snap.optionType === position.option_type &&
    snap.strike != null &&
    Math.abs(snap.strike - position.strike) <= 0.005 &&
    snap.expiry === String(position.expiry).slice(0, 10)
  );
}

/** Open legs that already price from snapshot (+ optional WS mark) skip the chain band fetch. */
export function positionNeedsChainFallback(
  position: UserPositionRow,
  snap: OptionSnapshot | null | undefined,
  liveMark: LiveMark | null
): boolean {
  if (position.status === "closed") return false;
  if (!snapshotMatchesPosition(position, snap)) return true;
  return valuationFromSnapshot(snap!, liveMark) == null;
}
