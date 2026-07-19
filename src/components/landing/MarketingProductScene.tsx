import type { CSSProperties, ReactNode } from "react";
import { clsx } from "clsx";
import type { MarketingProductId } from "@/lib/marketing/products";

export type MarketingSceneVariant = "full" | "card" | "hero";

type Props = {
  productId: MarketingProductId;
  accent: string;
  variant?: MarketingSceneVariant;
  className?: string;
};

const SPX_STRIKES = ["6015", "6020", "6025", "6030", "6035", "6040"];
const SPX_GEX = ["−1.8M", "+4.2M", "+2.1M", "−0.9M", "+1.4M", "−2.0M"];
const TAPE = [
  { side: "bull", sym: "SPXW", px: "6030C", prem: "$1.24M" },
  { side: "bear", sym: "SPY", px: "590P", prem: "$840K" },
  { side: "bull", sym: "QQQ", px: "520C", prem: "$2.1M" },
  { side: "bear", sym: "SPXW", px: "6010P", prem: "$620K" },
  { side: "bull", sym: "IWM", px: "215C", prem: "$410K" },
];

function SceneBoot() {
  return (
    <div className="mkt-scene-boot" aria-hidden>
      <div className="mkt-scene-boot-grid">
        {Array.from({ length: 8 }, (_, i) => (
          <span key={i} className="mkt-scene-boot-cell" style={{ animationDelay: `${i * 0.07}s` }} />
        ))}
      </div>
      <p className="mkt-scene-boot-label font-mono">
        <span className="mkt-scene-boot-pulse" />
        Syncing live desk…
      </p>
    </div>
  );
}

function SpxScene({ compact }: { compact?: boolean }) {
  const rows = compact ? 4 : 6;
  return (
    <div className="mkt-scene-spx">
      <div className="mkt-scene-spx-spot">
        <span className="font-mono">SPX</span>
        <span className="mkt-scene-spx-spot-val font-syne">6,028.40</span>
        <span className="mkt-scene-spx-spot-delta font-mono">+12.6</span>
        <span className="mkt-scene-live-pill font-mono">LIVE</span>
      </div>
      <div className={clsx("mkt-preview-matrix", compact && "mkt-preview-matrix--compact")}>
        {Array.from({ length: compact ? 20 : 30 }, (_, i) => (
          <span
            key={i}
            className="mkt-preview-matrix-cell"
            data-hot={i % 7 === 0 || i % 11 === 3 ? "1" : undefined}
            style={{ animationDelay: `${(i % 6) * 0.15}s` }}
          />
        ))}
      </div>
      {!compact && (
        <div className="mkt-scene-spx-ladder">
          {SPX_STRIKES.slice(0, rows).map((strike, i) => (
            <div
              key={strike}
              className={clsx(
                "mkt-hero-mock-row",
                i % 2 === 0 ? "mkt-hero-mock-row-bull" : "mkt-hero-mock-row-bear"
              )}
            >
              <span>{strike}</span>
              <span>{SPX_GEX[i]}</span>
              <span className="mkt-hero-mock-bar" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HelixScene({ compact }: { compact?: boolean }) {
  const rows = compact ? TAPE.slice(0, 3) : TAPE;
  const loop = [...rows, ...rows];
  return (
    <div className="mkt-scene-helix">
      <div className="mkt-scene-helix-head font-mono">
        <span>HELIX</span>
        <span className="mkt-scene-helix-count">847 prints · RTH</span>
      </div>
      <div className="mkt-scene-tape-viewport">
        <ul className={clsx("mkt-preview-tape", "mkt-scene-tape-track", compact && "mkt-scene-tape-track--slow")}>
          {loop.map((row, i) => (
            <li
              key={`${row.sym}-${row.px}-${i}`}
              className={clsx("mkt-preview-tape-row", row.side === "bull" ? "mkt-preview-tape-bull" : "mkt-preview-tape-bear")}
            >
              <span>{row.sym}</span>
              <span>{row.px}</span>
              <span>{row.prem}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ThermalScene({ compact }: { compact?: boolean }) {
  const cols = compact ? 5 : 8;
  const cells = compact ? 35 : 56;
  return (
    <div className="mkt-scene-thermal">
      <div className="mkt-scene-thermal-tabs font-mono">
        <span className="mkt-scene-tab-active">GEX</span>
        <span>VEX</span>
        <span>CHARM</span>
      </div>
      <div
        className="mkt-preview-heatmap mkt-scene-heat-grid"
        style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
      >
        {Array.from({ length: cells }, (_, i) => {
          const intensity = (i * 17 + 13) % 100;
          return (
            <span
              key={i}
              className="mkt-preview-heat-cell mkt-scene-heat-cell"
              style={{
                background: `color-mix(in srgb, var(--mkt-accent) ${18 + intensity * 0.55}%, transparent)`,
                animationDelay: `${(i % 8) * 0.12}s`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function LargoScene({ compact }: { compact?: boolean }) {
  return (
    <div className="mkt-preview-largo mkt-scene-largo">
      <p className="mkt-preview-largo-q mkt-scene-largo-q">
        Where is dealer gamma pinning SPX into the close?
      </p>
      <div className="mkt-preview-largo-a mkt-scene-largo-a">
        <span className="mkt-scene-largo-prefix font-mono">BIE ·</span>
        <span className={clsx("mkt-scene-largo-text", !compact && "mkt-scene-largo-text--full")}>
          {compact
            ? "6025 wall holds · charm supports above spot · invalidation 6018"
            : "6025 gamma wall holds into the bell. Charm supports above spot; vanna lift if we hold 6030. Invalidation 6018 — size down below."}
          <span className="mkt-scene-largo-cursor" aria-hidden />
        </span>
      </div>
      {!compact && (
        <div className="mkt-scene-largo-chips font-mono">
          <span>SPX desk</span>
          <span>HELIX tape</span>
          <span>Thermal</span>
        </div>
      )}
    </div>
  );
}

function HawkScene({ compact }: { compact?: boolean }) {
  return (
    <div className="mkt-preview-hawk mkt-scene-hawk">
      <div
        className="mkt-preview-grade mkt-scene-grade"
        style={{ borderColor: "#00e67655", color: "#00e676" }}
      >
        B+
      </div>
      <ul className="mkt-preview-hawk-log mkt-scene-hawk-log">
        <li className="mkt-scene-hawk-line" style={{ animationDelay: "0.9s" }}>
          NVDA · pullback · flow confirms
        </li>
        <li className="mkt-scene-hawk-line" style={{ animationDelay: "1.1s" }}>
          Invalidation · 142.50 · RTH gate
        </li>
        {!compact && (
          <>
            <li className="mkt-scene-hawk-line" style={{ animationDelay: "1.3s" }}>
              HELIX anomaly · Mar 150C block
            </li>
            <li className="mkt-scene-hawk-line" style={{ animationDelay: "1.5s" }}>
              Push queued · after verify ✓
            </li>
          </>
        )}
      </ul>
    </div>
  );
}

function VectorScene({ compact }: { compact?: boolean }) {
  return (
    <div className="mkt-preview-vector mkt-scene-vector">
      <div className="mkt-preview-radar mkt-scene-radar">
        <span className="mkt-preview-radar-ring" />
        <span className="mkt-preview-radar-ring mkt-preview-radar-ring-2" />
        <span className="mkt-scene-radar-sweep" aria-hidden />
        <span className="mkt-preview-radar-blip" style={{ color: "#7c5cff" }} />
        <span className="mkt-scene-radar-blip mkt-scene-radar-blip--2" style={{ color: "#22d3ee" }} />
      </div>
      <ul className="mkt-preview-vector-list">
        <li className="mkt-scene-vector-row" style={{ animationDelay: "1s" }}>
          NVDA · flow rank #1
        </li>
        <li className="mkt-scene-vector-row" style={{ animationDelay: "1.15s" }}>
          AAPL · gamma flip
        </li>
        {!compact && (
          <>
            <li className="mkt-scene-vector-row" style={{ animationDelay: "1.3s" }}>
              META · sweep cluster
            </li>
            <li className="mkt-scene-vector-row" style={{ animationDelay: "1.45s" }}>
              TSLA · charm pin
            </li>
          </>
        )}
      </ul>
    </div>
  );
}

function SceneBody({ productId, variant }: { productId: MarketingProductId; variant: MarketingSceneVariant }) {
  const compact = variant === "card";
  const map: Record<MarketingProductId, ReactNode> = {
    spx: <SpxScene compact={compact} />,
    helix: <HelixScene compact={compact} />,
    thermal: <ThermalScene compact={compact} />,
    largo: <LargoScene compact={compact} />,
    hawk: <HawkScene compact={compact} />,
    vector: <VectorScene compact={compact} />,
  };
  return map[productId];
}

/** CSS-only live desk render — boot shimmer → animated module scene (no stale screenshots). */
export function MarketingProductScene({ productId, accent, variant = "full", className }: Props) {
  return (
    <div
      className={clsx("mkt-scene", `mkt-scene--${productId}`, `mkt-scene--${variant}`, className)}
      style={{ "--mkt-accent": accent } as CSSProperties}
      aria-hidden
    >
      <SceneBoot />
      <div className="mkt-scene-live">
        <SceneBody productId={productId} variant={variant} />
      </div>
      <div className="mkt-scene-scanline" aria-hidden />
    </div>
  );
}
