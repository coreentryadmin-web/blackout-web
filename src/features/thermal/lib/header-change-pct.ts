import { rebaseChangePct } from "@/lib/providers/change-pct";

export type HeaderChangePctInput = {
  matrixChangePct: number | null | undefined;
  pushedLive: boolean;
  pushedSpot: number | null;
  matrixSpot: number;
  pushedChangePct: number | null | undefined;
  stockPushLive: boolean;
  stockPushChangePct: number | null | undefined;
  quoteLive: boolean;
  quoteChangePct: number | null | undefined;
  quotePrice: number | null | undefined;
};

/**
 * Thermal header tape change% — fail closed when the upstream lane has no measurement.
 * A fabricated flat 0% is worse than hiding the chip (TickerSwitcher omits when null).
 */
export function resolveHeaderChangePct(input: HeaderChangePctInput): number | null {
  const matrixChange =
    input.matrixChangePct != null && Number.isFinite(input.matrixChangePct)
      ? input.matrixChangePct
      : null;

  if (input.pushedLive && input.pushedSpot != null && input.pushedSpot > 0) {
    return (
      rebaseChangePct(input.pushedSpot, { price: input.matrixSpot, change_pct: matrixChange }) ??
      rebaseChangePct(input.pushedSpot, {
        price: input.quotePrice,
        change_pct: input.quoteChangePct,
      }) ??
      (input.pushedChangePct != null && Number.isFinite(input.pushedChangePct)
        ? input.pushedChangePct
        : null) ??
      (input.quoteLive && input.quoteChangePct != null && Number.isFinite(input.quoteChangePct)
        ? input.quoteChangePct
        : matrixChange)
    );
  }

  if (input.stockPushLive) {
    return input.stockPushChangePct != null && Number.isFinite(input.stockPushChangePct)
      ? input.stockPushChangePct
      : null;
  }

  if (input.quoteLive) {
    return input.quoteChangePct != null && Number.isFinite(input.quoteChangePct)
      ? input.quoteChangePct
      : null;
  }

  return matrixChange;
}
