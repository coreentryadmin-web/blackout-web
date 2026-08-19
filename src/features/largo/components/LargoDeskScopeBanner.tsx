"use client";

import { clsx } from "clsx";
import { deskScopeConfig } from "@/lib/largo/desk-scope";

export function LargoDeskScopeBanner({
  deskScope,
  ticker,
  onClear,
  className,
}: {
  deskScope?: string | null;
  ticker?: string | null;
  onClear?: () => void;
  className?: string;
}) {
  const cfg = deskScopeConfig(deskScope);
  if (!cfg) return null;

  return (
    <div className={clsx("largo-desk-scope-banner", className)} role="status">
      <span className="largo-desk-scope-pill">
        <span className="largo-desk-scope-label">{cfg.label}</span>
        {ticker && ticker !== cfg.defaultTicker && (
          <span className="largo-desk-scope-ticker">· {ticker}</span>
        )}
      </span>
      {onClear && (
        <button type="button" className="largo-desk-scope-clear" onClick={onClear}>
          Clear scope
        </button>
      )}
    </div>
  );
}
