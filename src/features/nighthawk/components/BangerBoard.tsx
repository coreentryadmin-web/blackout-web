"use client";

// ENGINE B — Banger board. A standalone, minimal member-facing surface (mirrors the read-only shape of
// ZeroDteBoard/HorizonLaneBoard) for the whole-market weekly-banger discovery + live scale-out engine.
// Mounted 2026-08-04 as the "Bangers" tab in the Night Hawk toggle (replacing the inactive LEAPS slot —
// see nighthawk-view.ts) — functional against /api/market/banger/board, polled every 30s.

import { useState } from "react";
import useSWR from "swr";
import { computeScaleOutTriggerInfo } from "@/lib/zerodte/scale-out";

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

function fmtPrice(v: number | null): string {
  return v != null ? `$${v.toFixed(2)}` : "—";
}

function fmtPct(v: number | null, opts?: { signed?: boolean }): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = opts?.signed && v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(0)}%`;
}

function fmtTimestamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** The 3-4 point discovery rationale members can actually parse at a glance — labeled, not a raw dump. */
function DiscoveryRationale({ discovery }: { discovery: BangerPlay["discovery"] }) {
  const items: Array<{ label: string; value: string }> = [];
  if (discovery.gain != null) items.push({ label: "Day gain", value: fmtPct(discovery.gain, { signed: true }) });
  if (discovery.dollar_vol != null) {
    items.push({ label: "$-volume", value: `$${(discovery.dollar_vol / 1_000_000).toFixed(1)}M` });
  }
  if (discovery.vol != null) items.push({ label: "Volume", value: discovery.vol.toLocaleString() });
  if (discovery.close_strength != null) {
    items.push({ label: "Close strength", value: `${(discovery.close_strength * 100).toFixed(0)}% of range` });
  }
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-bold uppercase tracking-wide text-white/50">Why it was picked</span>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        {items.map((it) => (
          <div key={it.label} className="flex items-baseline justify-between gap-2 text-xs">
            <span className="text-white/50">{it.label}</span>
            <span className="font-mono text-white/90">{it.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Scale-out state + the NEXT trigger level (computed live from SCALE_OUT_RULES, not a static string). */
function ScaleOutState({ play }: { play: BangerPlay }) {
  const isOpen = play.status === "OPEN" || play.status === "PARTIAL";
  const trigger = computeScaleOutTriggerInfo({
    entryPremium: play.entry_premium,
    peakPremium: play.peak_premium ?? play.entry_premium,
    lastMark: play.last_mark,
    scaledAlready: play.scaled_already,
  });
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-bold uppercase tracking-wide text-white/50">Exit state</span>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className="font-mono font-bold text-white/90">{play.scale_out_action ?? "HOLD"}</span>
        {play.scale_out_reason && <span className="text-white/60">— {play.scale_out_reason}</span>}
      </div>
      {isOpen && trigger.next_trigger_price != null && (
        <div className="text-xs text-white/60">
          Next: <span className="font-mono text-white/90">{trigger.next_trigger_label}</span> at{" "}
          <span className="font-mono text-white/90">{fmtPrice(trigger.next_trigger_price)}</span>
          {trigger.pct_to_next_trigger != null && (
            <>
              {" "}
              ({trigger.pct_to_next_trigger >= 0 ? "needs +" : "retrace of "}
              {Math.abs(trigger.pct_to_next_trigger).toFixed(0)}% from mark)
            </>
          )}
        </div>
      )}
      {isOpen && trigger.hard_stop_price != null && (
        <div className="text-xs text-rose-300/80">
          Hard stop: <span className="font-mono">{fmtPrice(trigger.hard_stop_price)}</span>
        </div>
      )}
    </div>
  );
}

function PlayDetail({ play }: { play: BangerPlay }) {
  return (
    <div className="flex flex-col gap-3 border-t border-white/10 px-3 py-3">
      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-bold uppercase tracking-wide text-white/50">Contract</span>
        <span className="font-mono text-xs text-white/80">
          {play.ticker} {play.contract.strike}C exp {play.contract.expiry} · {play.contract.occ}
        </span>
      </div>
      <ScaleOutState play={play} />
      <DiscoveryRationale discovery={play.discovery} />
      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-bold uppercase tracking-wide text-white/50">Timeline</span>
        <div className="flex justify-between text-xs">
          <span className="text-white/50">Committed</span>
          <span className="font-mono text-white/90">{fmtTimestamp(play.committed_at)}</span>
        </div>
        {play.closed_at && (
          <div className="flex justify-between text-xs">
            <span className="text-white/50">Closed</span>
            <span className="font-mono text-white/90">{fmtTimestamp(play.closed_at)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function PlayRow({ play }: { play: BangerPlay }) {
  const [expanded, setExpanded] = useState(false);
  const mult = multOf(play);
  return (
    <div className="nighthawk-metric-pill w-full rounded-md border border-white/10">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
      >
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
        <span className="text-[10px] text-white/40" aria-hidden="true">
          {expanded ? "▲" : "▼"}
        </span>
      </button>
      {expanded && <PlayDetail play={play} />}
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
