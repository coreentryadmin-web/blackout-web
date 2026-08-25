import type { EnrichedZeroDteSetup } from "../board";

/** Stamp Thermal positioning fields onto PIN setups so thesis POSITIONING rail can fire. */
export function stampPinSetupPositioning(
  setup: EnrichedZeroDteSetup,
  input: {
    gamma_posture: "long" | "short" | null;
    call_wall: number | null;
    put_wall: number | null;
    gex_king_strike?: number | null;
  }
): EnrichedZeroDteSetup {
  const gamma_regime =
    input.gamma_posture === "long"
      ? "long_gamma"
      : input.gamma_posture === "short"
        ? "short_gamma"
        : setup.gamma_regime;

  const key_resistances =
    input.call_wall != null
      ? [input.call_wall, ...(setup.key_resistances ?? [])].filter(
          (v, i, a) => a.indexOf(v) === i
        )
      : setup.key_resistances;

  const key_supports =
    input.put_wall != null
      ? [input.put_wall, ...(setup.key_supports ?? [])].filter((v, i, a) => a.indexOf(v) === i)
      : setup.key_supports;

  return {
    ...setup,
    gamma_regime,
    key_resistances,
    key_supports,
    gex_king_strike: input.gex_king_strike ?? setup.gex_king_strike ?? null,
  };
}
