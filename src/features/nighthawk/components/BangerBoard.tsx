"use client";

// ENGINE B — Banger board. A standalone, minimal member-facing surface (mirrors the read-only shape of
// ZeroDteBoard/HorizonLaneBoard) for the whole-market weekly-banger discovery + live scale-out engine.
// Mounted 2026-08-04 as the "Bangers" tab in the Night Hawk toggle (replacing the inactive LEAPS slot —
// see nighthawk-view.ts) — functional against /api/market/banger/board, polled every 30s.

import useSWR from "swr";

type BangerPlay = {
  id: number;
  ticker: string;
  session_date: string;
  contract: { strike: number; expiry: string; occ: string };
  entry_premium: number;
  last_mark: number | null;
  peak_premium: number | null;
  status: "OPEN" | "PARTIAL" | "CLOSED_RUNNER" | "STOPPED";
  scaled_already: boolean;
  scale_out_action: string | null;
  scale_out_reason: string | null;
  realized_pnl_pct: number | null;
  realized_pnl_usd: number | null;
  discovery: { gain: number | null; vol: number | null; dollar_vol: number | null; close_strength: number | null };
  committed_at: string | null;
  closed_at: string | null;
};

type BangerBoardResponse = {
  available: boolean;
  enabled?: boolean;
  reason?: string;
  as_of?: string;
  exit_rule_note?: string;
  open?: BangerPlay[];
  closed?: BangerPlay[];
};

async function fetchBangerBoard(url: string): Promise<BangerBoardResponse> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`banger board fetch failed: ${res.status}`);
  return res.json();
}

function statusLabel(status: BangerPlay["status"]): string {
  switch (status) {
    case "OPEN":
      return "Open";
    case "PARTIAL":
      return "Partial taken — trailing runner";
    case "CLOSED_RUNNER":
      return "Closed (runner)";
    case "STOPPED":
      return "Stopped";
    default:
      return status;
  }
}

function multOf(play: BangerPlay): number | null {
  const mark = play.last_mark;
  if (mark == null || !(play.entry_premium > 0)) return null;
  return mark / play.entry_premium;
}

function PlayRow({ play }: { play: BangerPlay }) {
  const mult = multOf(play);
  return (
    <div className="nighthawk-metric-pill flex w-full items-center justify-between gap-3 rounded-md border border-white/10 px-3 py-2">
      <div className="flex flex-col">
        <span className="font-mono text-sm font-bold">{play.ticker}</span>
        <span className="text-[11px] uppercase tracking-wide text-white/50">
          {play.contract.strike}C {play.contract.expiry}
        </span>
      </div>
      <div className="flex flex-col items-end">
        <span className="font-mono text-sm">
          ${play.entry_premium.toFixed(2)} → {play.last_mark != null ? `$${play.last_mark.toFixed(2)}` : "—"}
          {mult != null ? ` (${mult.toFixed(2)}x)` : ""}
        </span>
        <span className="text-[11px] text-white/60">{statusLabel(play.status)}</span>
      </div>
      {play.realized_pnl_pct != null && (
        <span
          className={`font-mono text-sm font-bold ${play.realized_pnl_pct >= 0 ? "text-emerald-400" : "text-rose-400"}`}
        >
          {play.realized_pnl_pct >= 0 ? "+" : ""}
          {play.realized_pnl_pct.toFixed(0)}%
        </span>
      )}
    </div>
  );
}

export function BangerBoard() {
  const { data, error, isLoading } = useSWR("/api/market/banger/board", fetchBangerBoard, {
    refreshInterval: 30_000,
  });

  if (isLoading) {
    return (
      <div className="nighthawk-record-strip" role="status">
        <span className="nighthawk-record-label">Banger board</span>
        <span className="nighthawk-record-value">Loading…</span>
      </div>
    );
  }

  if (error || !data?.available) {
    const reason = data?.reason ?? (error instanceof Error ? error.message : "unavailable");
    return (
      <div className="nighthawk-record-strip" role="status">
        <span className="nighthawk-record-label">Banger board</span>
        <span className="nighthawk-record-value">
          {data && data.enabled === false ? "Engine paused" : "Unavailable"} — {reason}
        </span>
      </div>
    );
  }

  const open = data.open ?? [];
  const closed = data.closed ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="nighthawk-record-strip" role="status">
        <span className="nighthawk-record-label">Banger board</span>
        <span className="nighthawk-record-value">{data.exit_rule_note}</span>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-white/60">
          Open ({open.length})
        </span>
        {open.length === 0 ? (
          <span className="text-sm text-white/50">No open banger positions.</span>
        ) : (
          open.map((p) => <PlayRow key={p.id} play={p} />)
        )}
      </div>
      {closed.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold uppercase tracking-wide text-white/60">
            Recently closed ({closed.length})
          </span>
          {closed.map((p) => (
            <PlayRow key={p.id} play={p} />
          ))}
        </div>
      )}
    </div>
  );
}
