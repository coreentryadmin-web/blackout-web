/** Member-facing copy for `gex.flip_reason` when `flip` is null. */

export type ThermalFlipReason =
  | "resolved"
  | "insufficient_strikes"
  | "net_short_everywhere"
  | "crossings_far_from_spot";

export function flipReasonChip(input: {
  flip: number | null;
  reason?: ThermalFlipReason | null;
}): { label: string; title: string } | null {
  if (input.flip != null) return null;
  const reason = input.reason;
  if (!reason || reason === "resolved") {
    return {
      label: "No γ flip",
      title: "No gamma flip level is defined for the current scope.",
    };
  }
  switch (reason) {
    case "net_short_everywhere":
      return {
        label: "Net short γ",
        title:
          "Dealers are net short gamma at every strike in scope — there is no long-gamma pocket, so no flip level exists.",
      };
    case "insufficient_strikes":
      return {
        label: "Flip N/A",
        title: "Not enough strikes in the chain to resolve a gamma flip for this scope.",
      };
    case "crossings_far_from_spot":
      return {
        label: "Flip N/A",
        title:
          "Gamma crossings exist but none are near spot — flip is withheld rather than showing a misleading level.",
      };
    default:
      return null;
  }
}
