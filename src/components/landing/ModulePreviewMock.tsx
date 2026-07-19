import type { CSSProperties } from "react";
import { MarketingProductScene } from "./MarketingProductScene";
import type { MarketingProductId } from "@/lib/marketing/products";

type Props = {
  moduleId: string;
  label: string;
  accent: string;
};

const ALT: Record<MarketingProductId, string> = {
  spx: "SPX Slayer — live 0DTE gamma matrix and dealer positioning desk",
  helix: "HELIX — institutional options flow tape with anomaly alerts",
  thermal: "BlackOut Thermal — dealer gamma heatmap across strikes and expiries",
  largo: "Largo — AI desk analyst grounded in live platform data",
  hawk: "Night Hawk — graded swing playbook and evening scanner",
  vector: "Vector — cross-ticker flow and gamma universe scan",
};

/** Live-rendered desk scene in chrome frame — CSS animation, no stale screenshots. */
export function ModulePreviewMock({ moduleId, label, accent }: Props) {
  const style = { "--mkt-accent": accent } as CSSProperties;
  const productId = moduleId as MarketingProductId;

  return (
    <div
      className={`mkt-module-preview mkt-module-preview--elevated mkt-card mkt-preview-${moduleId}`}
      style={{ borderColor: `${accent}33`, ...style }}
      role="img"
      aria-label={ALT[productId] ?? `${label} preview`}
    >
      <div className="mkt-module-preview-bar">
        <span className="mkt-module-preview-dot" style={{ background: accent }} />
        <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/60">{label}</span>
        <span className="mkt-module-preview-live font-mono text-[10px] uppercase tracking-[0.2em]">
          <span className="mkt-scene-live-dot" aria-hidden />
          Live render
        </span>
      </div>
      <div className="mkt-module-preview-body mkt-module-preview-body--shot">
        <MarketingProductScene productId={productId} accent={accent} variant="full" />
        <div className="mkt-module-shot-glow" aria-hidden />
      </div>
    </div>
  );
}
