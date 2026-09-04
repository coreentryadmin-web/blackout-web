"use client";

import { ThesisHealthPanel } from "./ThesisHealthPanel";
import type { ThesisHealthPayload } from "@/lib/zerodte/thesis-health";
import type { Recommendation } from "./types";

/** Swing-native thesis health — reuses the 0DTE pillar panel chrome with swing-computed payload. */
export function SwingThesisHealthPanel({
  health,
  liveRec,
}: {
  health: ThesisHealthPayload;
  liveRec: Recommendation;
}) {
  return <ThesisHealthPanel health={health} liveRec={liveRec} />;
}
