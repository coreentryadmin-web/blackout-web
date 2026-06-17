"use client";

import { useEffect, useState } from "react";
import { clsx } from "clsx";
import type { SpxPlayAction } from "@/lib/spx-play-engine";
import {
  SPX_SNIPER_BACKDROPS,
  sniperActionTint,
  sniperBackdropIntervalMs,
} from "@/lib/spx-sniper-backdrops";

type Props = {
  action?: SpxPlayAction;
};

export function SpxSniperBackdrop({ action }: Props) {
  const [active, setActive] = useState(0);
  const images = SPX_SNIPER_BACKDROPS;

  useEffect(() => {
    if (images.length <= 1) return;
    const ms = sniperBackdropIntervalMs();
    const timer = setInterval(() => {
      setActive((i) => (i + 1) % images.length);
    }, ms);
    return () => clearInterval(timer);
  }, [images.length]);

  return (
    <div className="spx-sniper-backdrop" aria-hidden>
      {images.map((src, i) => (
        <div
          key={src}
          className={clsx("spx-sniper-backdrop-layer", i === active && "is-active")}
          style={{ backgroundImage: `url(${src})` }}
        />
      ))}
      <div className={clsx("spx-sniper-backdrop-scrim", sniperActionTint(action))} />
    </div>
  );
}
