"use client";

import { clsx } from "clsx";
import type { SpxPlayAction } from "@/lib/spx-play-engine";
import { SPX_SNIPER_BACKDROP, sniperActionTint } from "@/lib/spx-sniper-backdrops";

type Props = {
  action?: SpxPlayAction;
};

export function SpxSniperBackdrop({ action }: Props) {
  return (
    <div className="spx-sniper-backdrop" aria-hidden>
      <div
        className="spx-sniper-backdrop-layer"
        style={{ backgroundImage: `url(${SPX_SNIPER_BACKDROP})` }}
      />
      <div className={clsx("spx-sniper-backdrop-scrim", sniperActionTint(action))} />
    </div>
  );
}
