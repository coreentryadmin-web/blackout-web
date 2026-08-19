"use client";

// ENGINE B — Banger board. A standalone, minimal member-facing surface (mirrors the read-only shape of
// ZeroDteBoard/HorizonLaneBoard) for the whole-market weekly-banger discovery + live scale-out engine.
// Mounted 2026-08-04 as the "Bangers" tab in the Night Hawk toggle (replacing the inactive LEAPS slot —
// see nighthawk-view.ts) — functional against /api/market/banger/board, polled every 30s.
//
// 2026-08-05: fixed two live bugs a member reported (mint-admin-session + live screenshot confirmed
// both — see FINDINGS.md). (1) The desktop Night Hawk shell locks `.nighthawk-single-view` to
// `height:100svh; overflow:hidden` (nighthawk-v2.css, ≥821px) so EVERY tab must provide its own
// internal scrollport — 0DTE/Swings do via `.nh-deck-rows` (globals.css: `overflow-y:auto;flex:1`),
// but this board rendered a plain non-scrolling flex column, so past the first ~9 of 60 open
// positions were silently clipped with no scrollbar and no way to reach them. Reusing the SAME
// `.nh-deck-rows` class (rather than inventing new CSS) fixes it and is free — that class already
// has iOS-shell and mobile-breakpoint overrides wired up app-wide. (2) The board also looked
// visually foreign next to 0DTE/Swings because it hand-rolled its own pill/strip classes instead of
// the shared `@/components/ui` primitives (Panel/Badge/EmptyState/Skeleton) those boards use —
// swapped in here for visual parity, without adopting the much heavier bespoke two-pane command-deck
// terminal (PlayTerminal/CommandDeck) that 0DTE/Swings use, which is a different master-detail UX
// this board's simple expand-in-place list doesn't need.

import { useState } from "react";
import useSWR from "swr";
import { Badge, EmptyState, Panel, Skeleton } from "@/components/ui";
import { computeScaleOutTriggerInfo } from "@/lib/zerodte/scale-out";
import { etDateTimeShort } from "@/lib/et-clock";

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

function statusTone(status: BangerPlay["status"]): "bull" | "bear" | "sky" | "accent" {
  switch (status) {
    case "OPEN":
      return "bull";
    case "PARTIAL":
      return "accent";
    case "CLOSED_RUNNER":
      return "sky";
    case "STOPPED":
      return "bear";
    default:
      return "sky";
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
  // `undefined` locale took the VIEWER's locale AND zone, so one row read "19 Aug, 19:30" in
  // London and "Aug 19, 2:30 PM" in New York for the same instant. Both pinned now.
  return etDateTimeShort(d) ?? "—";
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
    <div className="flex flex-col gap-3 border-t border-white/10 px-4 py-3">
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
    <div
      className={
        "rounded-xl border border-white/[0.08] bg-white/[0.02] transition-colors " +
        (expanded ? "bg-white/[0.03]" : "hover:bg-white/[0.03]")
      }
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 text-left"
      >
        <span className="font-mono text-sm font-bold text-white">{play.ticker}</span>
        <Badge tone={play.status === "OPEN" ? "sky" : "neutral"} size="sm">
          {play.contract.strike}C {play.contract.expiry}
        </Badge>
        <Badge tone={statusTone(play.status)} size="sm" dot={play.status === "OPEN"}>
          {statusLabel(play.status)}
        </Badge>
        <span className="ml-auto flex items-center gap-3">
          <span className="font-mono text-sm text-white/90">
            ${play.entry_premium.toFixed(2)} → {play.last_mark != null ? `$${play.last_mark.toFixed(2)}` : "—"}
            {mult != null ? ` (${mult.toFixed(2)}x)` : ""}
          </span>
          {play.realized_pnl_pct != null && (
            <Badge tone={play.realized_pnl_pct >= 0 ? "bull" : "bear"} size="sm">
              {play.realized_pnl_pct >= 0 ? "+" : ""}
              {play.realized_pnl_pct.toFixed(0)}%
            </Badge>
          )}
          <span className="text-[10px] text-white/40" aria-hidden="true">
            {expanded ? "▲" : "▼"}
          </span>
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
      <div className="space-y-4">
        <Skeleton className="h-20 w-full rounded-2xl" />
        <Skeleton className="h-72 w-full rounded-2xl" />
      </div>
    );
  }

  if (error || !data?.available) {
    const reason = data?.reason ?? (error instanceof Error ? error.message : "unavailable");
    return (
      <EmptyState
        icon="◆"
        title={data && data.enabled === false ? "Engine paused" : "Board temporarily unavailable"}
        description={reason}
      />
    );
  }

  const open = data.open ?? [];
  const closed = data.closed ?? [];

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-3">
      <Panel accent="bull" bodyClassName="px-5 py-4 md:px-6 md:py-4 shrink-0">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="bull" size="md" dot>
            Banger board
          </Badge>
          <span className="text-sm text-sky-100">{data.exit_rule_note}</span>
        </div>
      </Panel>

      {/* .nh-deck-rows: the SAME scrollport class 0DTE/Swings use (globals.css) — required
          because the desktop Night Hawk shell locks this tab's outer container to
          height:100svh/overflow:hidden (nighthawk-v2.css), so without an explicit internal
          scrollport, rows past the fold are clipped and unreachable (see file header). */}
      <div className="nh-deck-rows flex min-h-0 flex-1 flex-col gap-2 pr-1">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold uppercase tracking-wide text-white/60">Open ({open.length})</span>
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
    </div>
  );
}
