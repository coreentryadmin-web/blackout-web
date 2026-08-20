"use client";

import useSWR from "swr";
import Link from "next/link";
import { clsx } from "clsx";
import type { LargoMiniPanelPayload } from "@/lib/largo/mini-panel";

const fetcher = (url: string) => fetch(url, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null));

const TONE_CLASS: Record<string, string> = {
  bull: "largo-mini-tone-bull",
  bear: "largo-mini-tone-bear",
  warn: "largo-mini-tone-warn",
  neutral: "largo-mini-tone-neutral",
};

export function LargoDeskMiniPanel({
  desk,
  ticker,
  submodule,
  className,
}: {
  desk: string;
  ticker?: string | null;
  submodule?: string | null;
  className?: string;
}) {
  const qs = new URLSearchParams({ desk });
  if (ticker) qs.set("ticker", ticker);
  if (submodule) qs.set("submodule", submodule);
  const { data, isLoading, mutate } = useSWR<LargoMiniPanelPayload | null>(
    `/api/market/largo/mini-panel?${qs.toString()}`,
    fetcher,
    { refreshInterval: 20_000, revalidateOnFocus: true }
  );

  if (isLoading && !data) {
    return (
      <div className={clsx("largo-mini-panel largo-mini-panel-loading", className)} aria-hidden>
        <span className="largo-mini-panel-kicker">Live desk</span>
      </div>
    );
  }
  if (!data?.rows?.length) return null;

  return (
    <aside
      className={clsx("largo-mini-panel", data.stale && "largo-mini-panel-stale", className)}
      aria-label={`${data.label} live panel`}
    >
      <div className="largo-mini-panel-head">
        <span className="largo-mini-panel-kicker">{data.label}</span>
        <span className="largo-mini-panel-ticker">{data.ticker}</span>
        <div className="largo-mini-panel-actions">
          <button
            type="button"
            className="largo-mini-panel-refresh"
            onClick={() => void mutate()}
            aria-label="Refresh live panel"
          >
            ↻
          </button>
          {data.href && (
            <Link href={data.href} className="largo-mini-panel-open">
              Open desk
            </Link>
          )}
        </div>
      </div>
      <dl className="largo-mini-panel-rows">
        {data.rows.map((row) => (
          <div key={row.label} className="largo-mini-panel-row">
            <dt>{row.label}</dt>
            <dd className={clsx(row.tone && TONE_CLASS[row.tone])}>{row.value}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}
