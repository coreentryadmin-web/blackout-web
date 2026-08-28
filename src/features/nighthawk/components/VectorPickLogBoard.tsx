"use client";

import useSWR from "swr";
import { Badge, EmptyState, Panel, Skeleton } from "@/components/ui";
import { etDateTimeShort } from "@/lib/et-clock";

type VectorClosurePlay = {
  id: number;
  ticker: string;
  session_date: string;
  contract: {
    occ: string;
    side: string;
    strike: number;
    expiry: string;
    label: string | null;
  };
  rank: number | null;
  role: string | null;
  entry_mid: number | null;
  close_mid: number | null;
  premium_pct_from_entry: number | null;
  close_reason: string;
  setup_invalidated: boolean;
  spot: number | null;
  closed_at: string;
};

type VectorPickClosuresResponse = {
  available: boolean;
  degraded?: boolean;
  note?: string;
  closed?: VectorClosurePlay[];
};

async function fetchVectorClosures(url: string): Promise<VectorPickClosuresResponse> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`vector closures fetch failed: ${res.status}`);
  return res.json();
}

function fmtPrice(v: number | null): string {
  return v != null && Number.isFinite(v) ? `$${v.toFixed(2)}` : "—";
}

function fmtPct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(0)}%`;
}

function fmtTimestamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return etDateTimeShort(d) ?? "—";
}

/**
 * Night Hawk Vector tab — closed (Don't buy) Vector contract picks for system analysis.
 * Standalone board (same pattern as BangerBoard), not part of the horizon ledger.
 */
export function VectorPickLogBoard() {
  const { data, error, isLoading } = useSWR<VectorPickClosuresResponse>(
    "/api/market/vector/pick-closures/board",
    fetchVectorClosures,
    { refreshInterval: 30_000 }
  );

  const closed = data?.closed ?? [];

  if (isLoading && !data) {
    return (
      <div className="nh-deck-rows flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (error || data?.degraded) {
    return (
      <EmptyState
        title="Vector closures unavailable"
        description="The analysis log could not load right now — it will retry automatically."
      />
    );
  }

  if (!closed.length) {
    return (
      <EmptyState
        title="No closed Vector picks yet"
        description="When a Vector contract pick goes Don't buy (setup invalidated, premium chase, or desk cap), it is logged here for analysis."
      />
    );
  }

  return (
    <div className="nh-deck-rows flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pb-4">
      {data?.note ? (
        <p className="shrink-0 px-1 text-xs font-bold leading-snug text-sky-200">{data.note}</p>
      ) : null}
      {closed.map((row) => (
        <Panel key={row.id} className="vector-closure-row p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold text-white">{row.ticker}</span>
                <Badge tone="bear">Closed</Badge>
                {row.setup_invalidated ? <Badge tone="accent">Setup invalidated</Badge> : null}
              </div>
              <p className="mt-1 text-sm font-bold text-sky-100">
                {row.contract.label ?? `${row.contract.strike}${row.contract.side === "call" ? "C" : "P"}`}
                {row.rank != null ? ` · rank #${row.rank}` : ""}
              </p>
              <p className="mt-1 text-xs leading-snug text-sky-200">{row.close_reason}</p>
            </div>
            <div className="text-right text-xs text-sky-200">
              <div>{fmtTimestamp(row.closed_at)}</div>
              <div className="mt-1 font-bold text-white">
                {fmtPrice(row.entry_mid)} → {fmtPrice(row.close_mid)}
              </div>
              <div>{fmtPct(row.premium_pct_from_entry)} vs pick</div>
            </div>
          </div>
        </Panel>
      ))}
    </div>
  );
}
