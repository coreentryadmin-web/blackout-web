import type { VectorPlayEmit } from "./vector-play-engine";

/**
 * Stable key for resetting Vector pick archive state when the PLAY changes.
 * Spot is intentionally excluded — it ticks every second and must not wipe closed-pick history.
 */
export function vectorPickArchiveResetKey(
  emit: VectorPlayEmit | null,
  sessionFlowsLen: number,
  bias: string | null | undefined
): string {
  if (!emit) return "";
  const play = emit.play;
  return `${emit.callWall}|${emit.putWall}|${play?.conviction}|${play?.headline}|${sessionFlowsLen}|${bias ?? ""}`;
}

/** Debounce key for contract-pick refetch — same play fields + exclude list, no spot. */
export function vectorContractPickFetchKey(
  emit: VectorPlayEmit | null,
  sessionFlowsLen: number,
  excludeOccs: readonly string[]
): string {
  if (!emit) return "";
  const play = emit.play;
  const base = vectorPickArchiveResetKey(emit, sessionFlowsLen, play?.bias);
  return `${base}|${excludeOccs.join(",")}`;
}
