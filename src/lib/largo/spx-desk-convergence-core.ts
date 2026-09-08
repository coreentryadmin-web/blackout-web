import type { SpxPlayPayload } from "@/features/spx/lib/spx-play-payload";
import type { VectorPlay } from "@/features/vector/lib/vector-play-engine";
import type { VectorFullState } from "@/lib/bie/vector-full-state";

export type DeskPlayBias = "long" | "short" | "neutral" | "none";

export type DeskAlignment =
  | "aligned"
  | "divergent"
  | "slayer_leads"
  | "vector_leads"
  | "flat";

export function slayerSuggestedBias(play: SpxPlayPayload | null | undefined): DeskPlayBias {
  if (!play?.available) return "none";
  const dir = play.direction;
  if (dir === "long") return "long";
  if (dir === "short") return "short";
  if (play.open_play?.direction === "long") return "long";
  if (play.open_play?.direction === "short") return "short";
  if (play.action === "HOLD" || play.action === "TRIM") {
    return play.open_play?.direction === "short" ? "short" : play.open_play?.direction === "long" ? "long" : "neutral";
  }
  return "neutral";
}

export function vectorSuggestedBias(
  vector: VectorFullState | { available?: false; play?: VectorPlay | null } | null | undefined
): DeskPlayBias {
  if (!vector || (vector as { available?: boolean }).available === false) return "none";
  const play = (vector as VectorFullState).play;
  if (!play || play.setup === "stand-aside") return "neutral";
  if (play.bias === "long") return "long";
  if (play.bias === "short") return "short";
  return "neutral";
}

export function computeDeskAlignment(slayer: DeskPlayBias, vector: DeskPlayBias): DeskAlignment {
  if (slayer === "long" && vector === "long") return "aligned";
  if (slayer === "short" && vector === "short") return "aligned";
  if (
    (slayer === "long" && vector === "short") ||
    (slayer === "short" && vector === "long")
  ) {
    return "divergent";
  }
  if ((slayer === "long" || slayer === "short") && (vector === "none" || vector === "neutral")) {
    return "slayer_leads";
  }
  if ((vector === "long" || vector === "short") && (slayer === "none" || slayer === "neutral")) {
    return "vector_leads";
  }
  return "flat";
}
