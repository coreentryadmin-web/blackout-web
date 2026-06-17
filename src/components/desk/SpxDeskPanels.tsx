"use client";

import { clsx } from "clsx";
import type { SpxDeskPayload } from "@/lib/providers/spx-desk";
import { fmtPct, fmtPremium, fmtPrice } from "@/lib/api";

type DeskProps = { desk?: SpxDeskPayload; live?: boolean };

function Panel({
  title,
  subtitle,
  accent,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  accent: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("spx-desk-panel", accent, className)}>
      <div className="spx-desk-panel-header">
        <span className="badge-live-dot animate-pulse" />
        <div>
          <p className="font-syne text-xs tracking-[0.12em] uppercase font-bold">{title}</p>
          {subtitle && (
            <p className="font-mono text-[9px] tracking-[0.2em] uppercase text-grey-500 mt-0.5">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      <div className="spx-desk-panel-body">{children}</div>
    </div>
  );
}

export function SpxIntelStrip({ desk, live }: DeskProps) {
  const sectors = desk?.sector_heat ?? [];
  const macro = desk?.macro_events ?? [];
  const vt = desk?.vix_term;

  return (
    <div className="spx-intel-strip">
      <div className="spx-intel-chip">
        <span className="spx-intel-label">ADD</span>
        <span className="font-mono text-sm font-semibold tabular-nums">
          {live && desk?.add != null ? Math.round(desk.add) : "—"}
        </span>
      </div>
      <div className="spx-intel-chip">
        <span className="spx-intel-label">VIX9D</span>
        <span className="font-mono text-sm tabular-nums text-orange-300">
          {live && vt?.vix9d != null ? fmtPrice(vt.vix9d, 2) : "—"}
        </span>
      </div>
      <div className="spx-intel-chip">
        <span className="spx-intel-label">VIX3M</span>
        <span className="font-mono text-sm tabular-nums text-orange-300">
          {live && vt?.vix3m != null ? fmtPrice(vt.vix3m, 2) : "—"}
        </span>
      </div>
      <div
        className={clsx(
          "spx-intel-chip spx-intel-chip-wide",
          vt?.structure === "contango" && "text-bull",
          vt?.structure === "backwardation" && "text-bear"
        )}
      >
        <span className="spx-intel-label">Vol Term</span>
        <span className="font-mono text-xs uppercase tracking-wider capitalize">
          {live ? (vt?.structure ?? "—") : "—"}
        </span>
      </div>
      {sectors.slice(0, 6).map((s) => (
        <div key={s.ticker} className="spx-intel-chip spx-sector-chip">
          <span className="spx-intel-label">{s.ticker}</span>
          <span
            className={clsx(
              "font-mono text-[11px] tabular-nums font-semibold",
              s.change_pct >= 0 ? "num-bull" : "num-bear"
            )}
          >
            {fmtPct(s.change_pct)}
          </span>
        </div>
      ))}
      {macro.slice(0, 2).map((e) => (
        <div key={`${e.time}-${e.event}`} className="spx-intel-chip spx-intel-chip-wide">
          <span className="spx-intel-label">Macro</span>
          <span className="font-mono text-[10px] text-grey-200 truncate">{e.event}</span>
        </div>
      ))}
    </div>
  );
}

export function SpxDarkPoolCard({ desk, live }: DeskProps) {
  const dp = desk?.dark_pool;
  const prints = dp?.prints ?? [];

  return (
    <Panel title="Dark Pool" subtitle="SPX · institutional prints" accent="spx-panel-amber">
      {!live || !prints.length ? (
        <p className="font-mono text-[11px] text-grey-500 py-2">{dp?.detail ?? "No prints"}</p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 mb-2">
            <span
              className={clsx(
                "spx-desk-bias-pill",
                dp?.bias === "bullish" && "spx-bias-bull",
                dp?.bias === "bearish" && "spx-bias-bear",
                dp?.bias === "mixed" && "spx-bias-neutral"
              )}
            >
              {dp?.bias}
            </span>
            <span className="font-mono text-xs text-grey-400 tabular-nums">
              {fmtPremium(dp?.total_premium ?? 0)}
              {dp?.pcr != null ? ` · PCR ${dp.pcr}` : ""}
            </span>
          </div>
          <ul className="spx-desk-list">
            {prints.slice(0, 6).map((p, i) => (
              <li key={`${p.executed_at}-${i}`} className="spx-desk-list-row">
                <span className="text-grey-500 font-mono text-[10px]">
                  {new Date(p.executed_at).toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
                <span className="font-mono text-xs text-white tabular-nums">
                  {p.strike > 0 ? fmtPrice(p.strike) : "—"}
                </span>
                <span className="font-mono text-xs text-amber-300 tabular-nums ml-auto">
                  {fmtPremium(p.premium)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

export function SpxGexLadder({ desk, live }: DeskProps) {
  const walls = desk?.gex_walls ?? [];

  return (
    <Panel title="GEX Walls" subtitle="0DTE gamma nodes" accent="spx-panel-gold">
      {!live || !walls.length ? (
        <p className="font-mono text-[11px] text-grey-500 py-2">Loading gamma ladder…</p>
      ) : (
        <ul className="spx-desk-list">
          {walls.map((w) => (
            <li
              key={w.strike}
              className={clsx(
                "spx-desk-list-row border-l-2",
                w.kind === "support" ? "border-l-emerald-500/50" : "border-l-rose-500/50"
              )}
            >
              <span className="font-mono text-[10px] uppercase text-grey-500 w-16">{w.kind}</span>
              <span className="font-mono text-sm text-white tabular-nums">{fmtPrice(w.strike)}</span>
              <span
                className={clsx(
                  "font-mono text-xs tabular-nums ml-auto",
                  w.net_gex >= 0 ? "num-bull" : "num-bear"
                )}
              >
                {fmtPremium(w.net_gex)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {live && desk?.gamma_flip != null && (
        <p className="font-mono text-[10px] text-grey-400 mt-2 pt-2 border-t border-white/5">
          γ flip {fmtPrice(desk.gamma_flip)} · {desk.gamma_regime.replace("_", " ")}
        </p>
      )}
    </Panel>
  );
}

export function SpxFlowStrip({ desk, live }: DeskProps) {
  const flows = desk?.spx_flows ?? [];

  return (
    <Panel title="SPX Flow" subtitle="Options sweeps" accent="spx-panel-purple">
      {!live || !flows.length ? (
        <p className="font-mono text-[11px] text-grey-500 py-2">Waiting for SPX flow…</p>
      ) : (
        <ul className="spx-desk-list">
          {flows.slice(0, 8).map((f, i) => (
            <li key={`${f.alerted_at}-${i}`} className="spx-desk-list-row">
              <span
                className={clsx(
                  "font-mono text-[10px] font-bold uppercase w-10",
                  f.option_type === "CALL" ? "text-bull" : "text-bear"
                )}
              >
                {f.option_type.slice(0, 1)}
              </span>
              <span className="font-mono text-xs text-white tabular-nums">{fmtPrice(f.strike)}</span>
              <span className="font-mono text-[10px] text-grey-500">{f.expiry}</span>
              <span className="font-mono text-xs text-purple-light tabular-nums ml-auto">
                {fmtPremium(f.premium)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function SpxUnifiedTape({ desk, live }: DeskProps) {
  const tape = desk?.unified_tape ?? [];

  return (
    <Panel title="Live Tape" subtitle="Flow + dark pool" accent="spx-panel-cyan" className="spx-tape-panel">
      {!live || !tape.length ? (
        <p className="font-mono text-[11px] text-grey-500 py-2">Tape quiet…</p>
      ) : (
        <ul className="spx-desk-list spx-tape-list">
          {tape.map((t, i) => (
            <li key={`${t.time}-${i}`} className="spx-desk-list-row">
              <span
                className={clsx(
                  "font-mono text-[9px] uppercase tracking-wider w-12 shrink-0",
                  t.kind === "flow" ? "text-purple-light" : "text-amber-300"
                )}
              >
                {t.kind === "flow" ? "FLOW" : "DP"}
              </span>
              <span className="font-mono text-[10px] text-grey-500 shrink-0">
                {t.time
                  ? new Date(t.time).toLocaleTimeString("en-US", {
                      hour: "numeric",
                      minute: "2-digit",
                    })
                  : "—"}
              </span>
              <span className="font-mono text-xs text-white truncate">{t.label}</span>
              <span className="font-mono text-xs tabular-nums ml-auto shrink-0 text-grey-200">
                {fmtPremium(t.premium)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function SpxNetPremSpark({ desk, live }: DeskProps) {
  const ticks = desk?.net_prem_ticks ?? [];
  const values = ticks.map((t) => t.net);
  const max = Math.max(...values.map(Math.abs), 1);
  const w = 200;
  const h = 48;
  const points =
    values.length > 1
      ? values
          .map((v, i) => {
            const x = (i / (values.length - 1)) * w;
            const y = h / 2 - (v / max) * (h / 2 - 4);
            return `${x},${y}`;
          })
          .join(" ")
      : "";

  const last = values[values.length - 1];

  return (
    <Panel title="Net Prem Ticks" subtitle="SPY velocity" accent="spx-panel-teal">
      {!live || values.length < 2 ? (
        <p className="font-mono text-[11px] text-grey-500 py-2">Building tick series…</p>
      ) : (
        <div className="flex items-center gap-3">
          <svg viewBox={`0 0 ${w} ${h}`} className="spx-sparkline flex-1">
            <polyline
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="text-teal-400"
              points={points}
            />
          </svg>
          <span
            className={clsx(
              "font-mono text-sm font-semibold tabular-nums shrink-0",
              (last ?? 0) >= 0 ? "num-bull" : "num-bear"
            )}
          >
            {fmtPremium(last ?? 0)}
          </span>
        </div>
      )}
    </Panel>
  );
}

export function SpxIvTermBars({ desk, live }: DeskProps) {
  const curve = desk?.iv_term_structure ?? [];
  const maxIv = Math.max(...curve.map((p) => p.iv), 1);

  return (
    <Panel title="IV Term" subtitle="Implied vol curve" accent="spx-panel-violet">
      {!live || !curve.length ? (
        <p className="font-mono text-[11px] text-grey-500 py-2">IV curve loading…</p>
      ) : (
        <div className="spx-iv-bars">
          {curve.map((p) => (
            <div key={p.expiry} className="spx-iv-bar-col">
              <div
                className="spx-iv-bar-fill"
                style={{ height: `${Math.max(8, (p.iv / maxIv) * 100)}%` }}
                title={`${p.iv.toFixed(1)}%`}
              />
              <span className="font-mono text-[8px] text-grey-500 mt-1">{p.expiry.slice(5)}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

export function SpxOiChangeStrip({ desk, live }: DeskProps) {
  const items = desk?.oi_changes ?? [];

  return (
    <Panel title="OI Change" subtitle="Strike OI shifts" accent="spx-panel-rose">
      {!live || !items.length ? (
        <p className="font-mono text-[11px] text-grey-500 py-2">No OI shifts flagged</p>
      ) : (
        <ul className="spx-desk-list">
          {items.slice(0, 6).map((o, i) => (
            <li key={`${o.strike}-${i}`} className="spx-desk-list-row">
              <span className="font-mono text-xs text-white tabular-nums">{fmtPrice(o.strike)}</span>
              <span className="font-mono text-[10px] text-grey-500 uppercase">{o.kind}</span>
              <span
                className={clsx(
                  "font-mono text-xs tabular-nums ml-auto",
                  o.oi_change >= 0 ? "num-bull" : "num-bear"
                )}
              >
                {o.oi_change >= 0 ? "+" : ""}
                {o.oi_change.toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function OdteFlowBar({ desk, live }: { desk?: SpxDeskPayload; live?: boolean }) {
  const calls = desk?.flow_0dte_call_premium ?? 0;
  const puts = desk?.flow_0dte_put_premium ?? 0;
  const total = calls + puts || 1;
  const callPct = (calls / total) * 100;

  if (!live) return null;

  return (
    <div className="spx-odte-bar-wrap">
      <div className="flex justify-between font-mono text-[10px] mb-1">
        <span className="text-bull">0DTE Calls {fmtPremium(calls)}</span>
        <span className="text-bear">Puts {fmtPremium(puts)}</span>
      </div>
      <div className="spx-odte-bar">
        <div className="spx-odte-bar-call" style={{ width: `${callPct}%` }} />
      </div>
    </div>
  );
}
