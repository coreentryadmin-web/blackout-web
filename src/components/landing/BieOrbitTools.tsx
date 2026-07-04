"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { ProductMark, type MarkProduct } from "@/components/marks/ProductMark";
import { pointOnFieldLine } from "./bie-helix-engine";
import { viewBoxPointToContainer } from "./bie-viewbox-map";

export type OrbitTool = {
  name: string;
  href: string;
  mark: MarkProduct;
  accent: string;
  /** Fixed phase on the outer ring (degrees). */
  startAngleDeg: number;
};

type Props = {
  tools: OrbitTool[];
  viewW: number;
  viewH: number;
  coreX: number;
  coreY: number;
  maxRx: number;
  maxRy: number;
  orbitRing: number;
  orbitScale: number;
  orbitPeriodSec: number;
  reduceMotion: boolean;
};

/** Six instruments ride the outermost field line — slow planetary orbit around BIE. */
export function BieOrbitTools({
  tools,
  viewW,
  viewH,
  coreX,
  coreY,
  maxRx,
  maxRy,
  orbitRing,
  orbitScale,
  orbitPeriodSec,
  reduceMotion,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<(HTMLAnchorElement | null)[]>([]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let raf = 0;
    let orbitDeg = 0;
    let last = performance.now();

    const layout = (now: number) => {
      const rect = host.getBoundingClientRect();
      if (rect.width >= 1 && rect.height >= 1) {
        if (!reduceMotion) {
          const dt = (now - last) / 1000;
          last = now;
          orbitDeg = (orbitDeg + (360 / orbitPeriodSec) * dt) % 360;
        }

        tools.forEach((tool, i) => {
          const el = nodeRefs.current[i];
          if (!el) return;
          const angle = tool.startAngleDeg + orbitDeg;
          const vb = pointOnFieldLine(coreX, coreY, maxRx, maxRy, orbitScale, orbitRing, angle);
          const px = viewBoxPointToContainer(vb.x, vb.y, rect.width, rect.height, viewW, viewH, "slice");
          el.style.left = `${px.x}px`;
          el.style.top = `${px.y}px`;
        });
      }

      raf = requestAnimationFrame(layout);
    };

    raf = requestAnimationFrame(layout);
    const ro = new ResizeObserver(() => {
      last = performance.now();
    });
    ro.observe(host);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [
    tools,
    viewW,
    viewH,
    coreX,
    coreY,
    maxRx,
    maxRy,
    orbitRing,
    orbitScale,
    orbitPeriodSec,
    reduceMotion,
  ]);

  return (
    <div ref={hostRef} className="bie-orbit-tools" aria-label="Platform instruments">
      {tools.map((tool, i) => (
        <Link
          key={tool.name}
          ref={(el) => {
            nodeRefs.current[i] = el;
          }}
          href={tool.href}
          className="bie-orbit-tool"
          style={{ ["--tool-accent" as string]: tool.accent }}
        >
          <span className="bie-orbit-tool-mark" aria-hidden>
            <ProductMark product={tool.mark} size={34} />
          </span>
          <span className="bie-orbit-tool-name">{tool.name}</span>
        </Link>
      ))}
    </div>
  );
}
