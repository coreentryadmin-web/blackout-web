"use client";

import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import type { TerminalPlay } from "./types";

type Tab = "thesis" | "manage" | "pnl";

const GLAB: Record<string, string> = {
  delta: "Δ DELTA", gamma: "Γ GAMMA", theta: "Θ THETA", vega: "V VEGA", iv: "IV",
};

function fmtGreek(k: string, v: number | null): string {
  if (v == null) return "—";
  if (k === "iv") return `${Math.round(v * 100)}%`;
  if (k === "theta") return v.toFixed(2);
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
}

/** Flash a cell green/red when its value changes between renders (honest live-change feedback). */
function useFlash(value: unknown) {
  const prev = useRef(value);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (prev.current !== value) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 250);
      prev.current = value;
      return () => clearTimeout(t);
    }
  }, [value]);
  return flash;
}

function GreekCell({ k, v }: { k: string; v: number | null }) {
  const flash = useFlash(v);
  const neg = k === "theta" || (k === "delta" && (v ?? 0) < 0);
  return (
    <div className="nh-deck-gk">
      <div className="gl">{GLAB[k]}</div>
      <div className={clsx("gv", neg && "dn", flash && "neon")}>{fmtGreek(k, v)}</div>
    </div>
  );
}

function Bar({ pts }: { pts: number }) {
  const w = Math.max(2, Math.min(100, (Math.abs(pts) / 30) * 100));
  return <div className="bar"><i style={{ width: `${w}%` }} /></div>;
}

export function PlayTerminal({ play }: { play: TerminalPlay | null }) {
  const [tab, setTab] = useState<Tab>("thesis");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "1") setTab("thesis");
      else if (e.key === "2") setTab("manage");
      else if (e.key === "3") setTab("pnl");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const markFlash = useFlash(play?.mark ?? null); // hook must run unconditionally (before any early return)

  if (!play) {
    return <div className="nh-deck-right"><div className="nh-deck-empty">◂ select a play to break it down</div></div>;
  }
  const g = play.greeks;

  return (
    <div className="nh-deck-right">
      <div className="nh-deck-th">
        <span className="tk">{play.ticker} · {play.direction}</span>
        <span className="ct">{play.contract}</span>
        <span className="nh-deck-cursor" aria-hidden />
        <span className="big"><div className="nh-deck-score">{play.score}</div><div className="lab">SCORE</div></span>
      </div>

      <div className="nh-deck-stream">
        <span className="nh-deck-dot" /><span className="lv">LIVE</span> · marks push · mark{" "}
        <span className={clsx(markFlash && "neon")}>{play.mark != null ? `$${play.mark.toFixed(2)}` : "—"}</span>
      </div>

      <div className="nh-deck-greeks">
        <GreekCell k="delta" v={g?.delta ?? null} />
        <GreekCell k="gamma" v={g?.gamma ?? null} />
        <GreekCell k="theta" v={g?.theta ?? null} />
        <GreekCell k="vega" v={g?.vega ?? null} />
        <GreekCell k="iv" v={g?.iv ?? null} />
      </div>

      <div className="nh-deck-tabs">
        <button className={clsx(tab === "thesis" && "on")} onClick={() => setTab("thesis")}><span className="n">[1]</span>Thesis</button>
        <button className={clsx(tab === "manage" && "on")} onClick={() => setTab("manage")}><span className="n">[2]</span>Management</button>
        <button className={clsx(tab === "pnl" && "on")} onClick={() => setTab("pnl")}><span className="n">[3]</span>PnL</button>
      </div>

      <div className="nh-deck-body">
        {tab === "thesis" && <ThesisPanel play={play} />}
        {tab === "manage" && <ManagePanel play={play} />}
        {tab === "pnl" && <PnlPanel play={play} />}
      </div>

      <div className="nh-deck-foot">
        <span>EXIT · {play.exitModel}</span>
        <span>CONF {play.confidence != null ? `${Math.round(play.confidence * 100)}%` : "—"}</span>
        {play.allocation && <span style={{ marginLeft: "auto" }}>{play.allocation.role} · {play.allocation.sizing}</span>}
      </div>
    </div>
  );
}

function ThesisPanel({ play }: { play: TerminalPlay }) {
  const level = play.thesisBreak?.level ?? "intact";
  const broke = level === "warn" || level === "break";
  const unknown = level === "unknown";
  return (
    <>
      <div className="nh-deck-lab">Why this play was picked</div>
      {play.factors.length === 0 && <div className="nh-deck-recnote">Component breakdown not served for this lane yet — score {play.score}. {play.recNote}</div>}
      {play.factors.map((f) => (
        <div key={f.label} className={clsx("nh-deck-fac", f.points < 0 && "neg")}>
          <div>{f.label}{f.points > 0 && <Bar pts={f.points} />}</div>
          <div className="pts">{f.points > 0 ? "+" : ""}{f.points}</div>
        </div>
      ))}
      {play.gates.length > 0 && (
        <>
          <div className="nh-deck-lab" style={{ marginTop: 16 }}>Hard gates</div>
          <div className="nh-deck-gaterow">
            {play.gates.map((g) => (
              <span key={g.label} className={clsx("nh-deck-gate", g.ok ? "ok" : "no")}>{g.ok ? "✓" : "✗"} {g.label}</span>
            ))}
          </div>
        </>
      )}
      <div className="nh-deck-meta">
        {play.regime && <div><span className="k">Regime</span><span className="v">{play.regime}</span></div>}
        {play.confidence != null && <div><span className="k">Confidence</span><span className="v">{Math.round(play.confidence * 100)}%</span></div>}
        {play.allocation && <div><span className="k">Allocation</span><span className="v">{play.allocation.role}</span></div>}
        <div><span className="k">Exit model</span><span className="v">{play.exitModel}</span></div>
      </div>
      <div
        className="nh-deck-break"
        style={broke ? undefined : { borderColor: unknown ? "rgba(255,255,255,.14)" : "rgba(53,255,158,.2)" }}
      >
        <div className="bh" style={broke ? undefined : { color: unknown ? "var(--dk-amber)" : "var(--dk-green)" }}>◉ LIVE THESIS MONITOR</div>
        <div className="nh-deck-feed">
          {broke ? (
            <div><span className="brk">✗ THESIS DEGRADING</span> — {play.thesisBreak!.note}. Recommend {play.recommendation}.</div>
          ) : unknown ? (
            // Data-absent (e.g. a working position with no fresh tape read) — neutral, NOT a false green
            // and NOT a false "degrading". Honest: we're not monitoring the thesis for this play right now.
            <div><span className="warn">• thesis not monitored</span> — {play.thesisBreak?.note ?? "live tape read unavailable for this play"}.</div>
          ) : (
            <div><span className="ok">✓ thesis intact</span> — evidence holding; monitor updates on each marks push.</div>
          )}
        </div>
      </div>
    </>
  );
}

function ManagePanel({ play }: { play: TerminalPlay }) {
  const badge = play.recommendation;
  return (
    <>
      <div className="nh-deck-lab">Trade management — advisory (we recommend, you execute)</div>
      <div className="nh-deck-rec">
        <span className={clsx("nh-deck-recb", badge)}>{badge}</span>
        {/* Plain text only — never inject HTML (recNote is authored plain; React escapes it safely). */}
        <span className="nh-deck-recnote">{play.recNote}</span>
      </div>
      {play.exitModel === "RATCHET" && play.progress != null && (
        <>
          <div className="nh-deck-track">
            <span className="lo">STOP −50%</span><span className="hi">TARGET +100%</span>
            <span className="mk" style={{ left: `${Math.round(play.progress * 100)}%` }} />
          </div>
          <div className="nh-deck-recnote">Ratchet: fast 0DTE exit — stop trails up as it runs. Marker = distance stop→target.</div>
        </>
      )}
      {play.exitModel === "SCALE_OUT" && (
        <>
          <div className="nh-deck-tranches">
            <div className={clsx("nh-deck-tr", (play.pnlPct ?? 0) >= 50 && "done")}><span className="p">⅓</span>@ +50%</div>
            <div className={clsx("nh-deck-tr", (play.pnlPct ?? 0) >= 100 ? "done" : "run")}><span className="p">⅓</span>@ +100%</div>
            <div className="nh-deck-tr"><span className="p">⅓</span>runner · trail</div>
          </div>
          <div className="nh-deck-recnote">Scale-out: bank partials at each tranche, trail the runner — the positive-skew exit.</div>
        </>
      )}
    </>
  );
}

function PnlPanel({ play }: { play: TerminalPlay }) {
  const has = play.entry != null;
  const live = play.pnlPct;
  return (
    <>
      <div className="nh-deck-lab">Live P&amp;L</div>
      <div className={clsx("nh-deck-pnlbig", (live ?? 0) > 0 && "nh-deck-pos", (live ?? 0) < 0 && "nh-deck-neg")}>
        {has && live != null ? `${live > 0 ? "+" : ""}${live}%` : "— not entered"}
      </div>
      <div className="nh-deck-grid">
        <div><span className="k">Entry</span><span className="v">{has ? `$${play.entry!.toFixed(2)}` : "—"}</span></div>
        <div><span className="k">Live mark</span><span className="v">{play.mark != null ? `$${play.mark.toFixed(2)}` : "—"}</span></div>
        <div><span className="k">Peak</span><span className="v nh-deck-pos">{play.peak != null ? `+${play.peak}%` : "—"}</span></div>
        <div><span className="k">Trough</span><span className="v nh-deck-neg">{play.trough != null ? `${play.trough}%` : "—"}</span></div>
      </div>
      <div className="nh-deck-recnote" style={{ marginTop: 16 }}>Peak/trough = the full excursion since entry — how much heat you took and gave back.</div>
    </>
  );
}
