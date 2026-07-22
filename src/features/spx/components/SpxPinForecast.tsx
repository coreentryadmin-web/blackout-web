"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useSpxPinForecast } from "@/features/spx/hooks/useSpxPinForecast";
import type { SpxPinForecast as PinPayload } from "@/features/spx/lib/spx-pin";
import type { PinConeStep, PinScenario } from "@/features/spx/lib/spx-pin-forecast-core";

const C = {
  bg: "#0f151f", panel: "#131b28", line: "#1e2836", ink: "#e7eef6", muted: "#8595ab", faint: "#556074",
  pin: "#ffd23f", call: "#00e676", put: "#bf5fff", flip: "#38bdf8", warn: "#ff8a3d",
  mono: 'ui-monospace,"SF Mono",Menlo,Consolas,monospace',
};
const fmt = (n: number | null | undefined, d = 0) =>
  n == null || !Number.isFinite(n) ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const KIND_LABEL: Record<string, string> = { call_wall: "call wall", put_wall: "put wall", max_pain: "max pain", flip: "gamma flip", path: "path cluster" };

export function SpxPinForecast({ sessionActive = true }: { sessionActive?: boolean }) {
  const { pin, pinLoading } = useSpxPinForecast(sessionActive);
  const [method, setMethod] = useState<"analytic" | "montecarlo">("analytic");
  const [showWhy, setShowWhy] = useState(false);

  // Active engine view: analytic base, or the Monte-Carlo overlay when available + selected.
  const view = useMemo(() => {
    if (!pin) return null;
    const mc = pin.montecarlo;
    // pinPx = the discrete pin STRIKE (snapped to the magnet); projPx = the UNSNAPPED live projected
    // close (drifts sub-strike intraday). The headline shows projPx so the forecaster visibly breathes
    // even on a quiet pinning day; pinPx is shown as the magnet target it rounds to.
    if (method === "montecarlo" && mc)
      return { cone: mc.cone, pinPx: mc.pin, projPx: mc.projectedClose ?? mc.pin, pinPct: mc.pinPct, band: mc.pinBand, scenarios: mc.scenarios };
    return { cone: pin.cone, pinPx: pin.pin, projPx: pin.projectedClose ?? pin.pin, pinPct: pin.pinPct, band: pin.pinBand, scenarios: pin.scenarios };
  }, [pin, method]);

  if (pinLoading && !pin) return <Shell><div style={{ color: C.muted, fontFamily: C.mono, fontSize: 12, padding: 24 }}>Loading pin forecast…</div></Shell>;
  if (!pin || !pin.available || !view || !view.cone.length) {
    const why = pin?.drivers?.[0];
    return (
      <Shell>
        <Header method={method} setMethod={setMethod} hasMc={false} />
        <div style={{ color: C.muted, fontFamily: C.mono, fontSize: 12.5, padding: 24, lineHeight: 1.5 }}>
          <b style={{ color: C.ink }}>{why?.label ?? "Collecting"}</b><br />{why?.detail ?? "Waiting for a live 0DTE chain."}
        </div>
      </Shell>
    );
  }

  const chart = buildChart(pin, view.cone, view.pinPx);
  const magnet = pin.magnet;
  const conf = view.pinPct ?? 0;

  return (
    <Shell>
      <Header method={method} setMethod={setMethod} hasMc={Boolean(pin.montecarlo)} />
      {pin.degraded && (
        <div style={{ margin: "0 14px 8px", padding: "6px 10px", borderRadius: 8, fontFamily: C.mono, fontSize: 11.5, color: C.warn, background: "rgba(255,138,61,.08)", border: "1px solid rgba(255,138,61,.35)" }}>
          ⚠ Low conviction — {pin.degradeReason === "macro_event" ? "macro event can overwhelm dealer pinning" : "realized vol is running above implied (trending, not pinning)"}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr", gap: 0 }} className="spx-pin-grid">
        {/* ── chart ── */}
        <div style={{ padding: "6px 8px 10px 12px", borderRight: `1px solid ${C.line}` }}>
          <svg viewBox={`0 0 ${chart.W} ${chart.H}`} width="100%" role="img"
               aria-label={`SPX 0DTE projected close ${fmt(view.projPx, 1)} at ${Math.round(conf * 100)}% confidence`}>
            {/* level lines */}
            {chart.levels.map((l) => (
              <g key={l.label}>
                <line x1={chart.padL} y1={l.y} x2={chart.W - chart.padR} y2={l.y} stroke={l.color} strokeWidth={1} strokeDasharray={l.dash} opacity={0.55} />
                <text x={chart.padL + 3} y={l.y - 3} fontFamily={C.mono} fontSize={9.5} fill={l.color}>{l.label} {fmt(l.price)}</text>
              </g>
            ))}
            {/* probability cone */}
            <path d={chart.conePath} fill="url(#pinCone)" stroke="none" />
            <path d={chart.medianPath} fill="none" stroke={C.pin} strokeWidth={1.6} strokeDasharray="5 4" opacity={0.85} />
            <defs>
              <linearGradient id="pinCone" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor={C.pin} stopOpacity="0" /><stop offset="1" stopColor={C.pin} stopOpacity="0.26" />
              </linearGradient>
            </defs>
            {/* observed spot dot @ now */}
            <circle cx={chart.padL} cy={chart.y(pin.spot)} r={4} fill={C.flip} stroke={C.bg} strokeWidth={1.5} />
            {/* clickable pin marker @ close */}
            <g style={{ cursor: "pointer" }} onClick={() => setShowWhy((s) => !s)} tabIndex={0}
               onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setShowWhy((s) => !s); } }}
               role="button" aria-pressed={showWhy} aria-label="Explain this projection">
              <circle cx={chart.W - chart.padR} cy={chart.y(view.projPx ?? pin.spot)} r={6} fill={C.pin} stroke={C.bg} strokeWidth={1.5} />
              <circle cx={chart.W - chart.padR} cy={chart.y(view.projPx ?? pin.spot)} r={10} fill="none" stroke={C.pin} strokeWidth={1} opacity={0.5} />
              <rect x={chart.W - chart.padR - 128} y={chart.y(view.projPx ?? pin.spot) - 30} width={120} height={22} rx={5} fill="#141b12" stroke={C.pin} strokeOpacity={0.5} />
              <text x={chart.W - chart.padR - 120} y={chart.y(view.projPx ?? pin.spot) - 15} fontFamily={C.mono} fontSize={11} fill={C.pin}>
                {fmt(view.projPx, 1)} · {Math.round(conf * 100)}%
              </text>
            </g>
            {/* x labels */}
            <text x={chart.padL} y={chart.H - 4} fontFamily={C.mono} fontSize={9.5} fill={C.faint}>now</text>
            <text x={chart.W - chart.padR} y={chart.H - 4} textAnchor="end" fontFamily={C.mono} fontSize={9.5} fill={C.faint}>16:00 close</text>
          </svg>
          <div style={{ fontFamily: C.mono, fontSize: 10.5, color: C.faint, paddingLeft: 4, marginTop: 2 }}>
            {method === "montecarlo" ? `${pin.montecarlo?.paths ?? 0} Monte-Carlo paths` : "analytic drift-to-magnet cone"} · tap the pin for the why →
          </div>
        </div>

        {/* ── rail / why ── */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          {showWhy ? (
            <WhyPanel pin={pin} scenarios={view.scenarios} onClose={() => setShowWhy(false)} />
          ) : (
            <>
              <Card label="Projected close">
                {/* Live, unsnapped projection (1dp) so it moves intraday — not the frozen strike. */}
                <div style={{ fontFamily: C.mono, fontSize: 34, fontWeight: 600, color: C.pin, lineHeight: 1 }}>{fmt(view.projPx, 1)}</div>
                <div style={{ fontFamily: C.mono, fontSize: 12, color: C.muted, marginTop: 6 }}>
                  {pin.pinPctOfClose != null && <span style={{ color: pin.pinPctOfClose >= 0 ? C.call : C.put }}>{pin.pinPctOfClose >= 0 ? "▲ +" : "▼ "}{fmt(pin.pinPctOfClose, 2)}%</span>} · {fmt((view.projPx ?? pin.spot) - pin.spot, 1)} pts vs spot
                </div>
                {/* The strike it pins to — the discrete target the live projection rounds onto. */}
                {view.pinPx != null && (
                  <div style={{ fontFamily: C.mono, fontSize: 11.5, color: C.faint, marginTop: 7 }}>
                    pins to <span style={{ color: C.ink }}>{fmt(view.pinPx)}</span>{magnet ? ` ${KIND_LABEL[magnet.kind] ?? ""}` : ""}
                  </div>
                )}
              </Card>
              <Card label="Pin confidence">
                <ConfBar pct={conf} />
                <div style={{ fontFamily: C.mono, fontSize: 11.5, color: C.muted, marginTop: 8 }}>
                  close in {fmt(view.band?.[0])}–{fmt(view.band?.[1])} · tightens into the bell
                </div>
              </Card>
              <Card label="Dominant magnet">
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 22, color: magnet?.direction === "up" ? C.call : magnet?.direction === "down" ? C.put : C.muted }}>
                    {magnet?.direction === "up" ? "↑" : magnet?.direction === "down" ? "↓" : "•"}
                  </span>
                  <div>
                    <div style={{ fontFamily: C.mono, fontSize: 15, fontWeight: 600, color: C.ink }}>{fmt(magnet?.strike)} {KIND_LABEL[magnet?.kind ?? ""] ?? ""}</div>
                    <div style={{ fontSize: 11, color: C.muted }}>{Math.round((magnet?.strengthPct ?? 0) * 100)}% of open interest</div>
                  </div>
                </div>
              </Card>
              <Card label="Regime · charm">
                <span style={{ fontFamily: C.mono, fontSize: 11.5, padding: "3px 9px", borderRadius: 999, border: `1px solid ${pin.regime === "short_gamma" ? "rgba(255,138,61,.4)" : "rgba(0,230,118,.35)"}`, color: pin.regime === "short_gamma" ? C.warn : C.call, background: pin.regime === "short_gamma" ? "rgba(255,138,61,.08)" : "rgba(0,230,118,.08)" }}>
                  {pin.regime === "short_gamma" ? `SHORT γ · below flip ${fmt(pin.flip)}` : pin.regime === "long_gamma" ? `LONG γ · above flip ${fmt(pin.flip)}` : "regime forming"}
                </span>
                <div style={{ fontFamily: C.mono, fontSize: 11.5, color: C.muted, marginTop: 9 }}>
                  charm <b style={{ color: C.ink }}>{pin.charmState}</b> · {fmt(pin.timeToCloseMin)}m to close
                </div>
              </Card>
              <button onClick={() => setShowWhy(true)}
                style={{ margin: "auto 14px 14px", padding: "9px 12px", borderRadius: 8, cursor: "pointer", fontFamily: C.mono, fontSize: 12.5, fontWeight: 600, color: C.bg, background: C.pin, border: "none" }}>
                Why this pin? →
              </button>
            </>
          )}
        </div>
      </div>
      <style>{`@media(max-width:760px){.spx-pin-grid{grid-template-columns:1fr !important}}`}</style>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, background: C.bg, overflow: "hidden" }}>{children}</div>;
}

function Header({ method, setMethod, hasMc }: { method: "analytic" | "montecarlo"; setMethod: (m: "analytic" | "montecarlo") => void; hasMc: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderBottom: `1px solid ${C.line}` }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 650, color: C.ink, letterSpacing: ".02em" }}>EOD <span style={{ color: C.pin }}>PIN</span> FORECASTER</span>
        <span style={{ fontFamily: C.mono, fontSize: 10.5, color: C.muted, border: `1px solid ${C.line}`, borderRadius: 5, padding: "1px 6px" }}>SPX · 0DTE</span>
      </div>
      <div style={{ display: "inline-flex", border: `1px solid ${C.line}`, borderRadius: 7, overflow: "hidden" }}>
        {(["analytic", "montecarlo"] as const).map((m) => (
          <button key={m} onClick={() => setMethod(m)} disabled={m === "montecarlo" && !hasMc}
            style={{ padding: "4px 10px", fontFamily: C.mono, fontSize: 10.5, cursor: m === "montecarlo" && !hasMc ? "not-allowed" : "pointer", border: "none",
              color: method === m ? C.bg : C.muted, background: method === m ? C.pin : "transparent", opacity: m === "montecarlo" && !hasMc ? 0.4 : 1 }}>
            {m === "analytic" ? "Analytic" : "Monte Carlo"}
          </button>
        ))}
      </div>
    </div>
  );
}

function Card({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ padding: "13px 16px", borderBottom: `1px solid ${C.line}` }}>
      <div style={{ fontSize: 10.5, letterSpacing: ".14em", textTransform: "uppercase", color: C.muted, marginBottom: 7 }}>{label}</div>
      {children}
    </div>
  );
}

function ConfBar({ pct }: { pct: number }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontFamily: C.mono, fontSize: 26, fontWeight: 600, color: C.ink }}>{Math.round(pct * 100)}%</span>
      </div>
      <div style={{ height: 7, borderRadius: 5, background: "#1b2433", marginTop: 6, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${Math.round(pct * 100)}%`, background: `linear-gradient(90deg,rgba(255,210,63,.4),${C.pin})` }} />
      </div>
    </div>
  );
}

function WhyPanel({ pin, scenarios, onClose }: { pin: PinPayload; scenarios: PinScenario[]; onClose: () => void }) {
  const maxW = Math.max(0.01, ...pin.drivers.map((d) => d.weight));
  return (
    <div style={{ padding: "13px 16px", display: "flex", flexDirection: "column", gap: 12, height: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 10.5, letterSpacing: ".14em", textTransform: "uppercase", color: C.pin }}>Why this pin</span>
        <button onClick={onClose} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontFamily: C.mono, fontSize: 16, lineHeight: 1 }} aria-label="Close">×</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {pin.drivers.map((d, i) => (
          <div key={i}>
            <div style={{ fontFamily: C.mono, fontSize: 12, color: C.ink, fontWeight: 600 }}>{d.label}</div>
            <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.4, margin: "2px 0 5px" }}>{d.detail}</div>
            <div style={{ height: 4, borderRadius: 3, background: "#1b2433", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.round((d.weight / maxW) * 100)}%`, background: C.pin, opacity: 0.55 }} />
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: "auto" }}>
        <div style={{ fontSize: 10.5, letterSpacing: ".14em", textTransform: "uppercase", color: C.muted, marginBottom: 6 }}>Scenarios</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: C.mono, fontSize: 12 }}>
          <tbody>
            {scenarios.map((s, i) => (
              <tr key={i}>
                <td style={{ padding: "3px 0", color: i === 0 ? C.pin : C.muted }}>{fmt(s.close)}</td>
                <td style={{ textAlign: "right", color: C.muted }}>{KIND_LABEL[s.kind] ?? s.kind}</td>
                <td style={{ textAlign: "right", color: C.ink, fontVariantNumeric: "tabular-nums" }}>{Math.round(s.p * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── chart geometry (auto-scaled from the cone + key levels) ──
function buildChart(pin: PinPayload, cone: PinConeStep[], pinPx: number | null) {
  const W = 520, H = 300, padL = 46, padR = 150, padT = 16, padB = 20;
  const levels: { label: string; price: number; color: string; dash: string }[] = [];
  if (pin.magnet) levels.push({ label: pin.magnet.kind === "put_wall" ? "PUT WALL" : pin.magnet.kind === "max_pain" ? "MAX PAIN" : "CALL WALL", price: pin.magnet.strike, color: pin.magnet.kind === "put_wall" ? C.put : pin.magnet.kind === "max_pain" ? C.pin : C.call, dash: "0" });
  if (pin.flip != null) levels.push({ label: "γ FLIP", price: pin.flip, color: C.flip, dash: "7 5" });
  const prices = [...cone.flatMap((c) => [c.p10, c.p90]), pin.spot, ...(pinPx != null ? [pinPx] : []), ...levels.map((l) => l.price)].filter((n) => Number.isFinite(n));
  let lo = Math.min(...prices), hi = Math.max(...prices);
  const pad = Math.max((hi - lo) * 0.08, 3); lo -= pad; hi += pad;
  const y = (p: number) => padT + (1 - (p - lo) / Math.max(hi - lo, 1e-6)) * (H - padT - padB);
  const tMax = pin.timeToCloseMin || Math.max(...cone.map((c) => c.tMin), 1);
  const x = (tMin: number) => padL + (1 - tMin / Math.max(tMax, 1e-6)) * (W - padL - padR);
  const top = cone.map((c) => `${x(c.tMin).toFixed(1)},${y(c.p90).toFixed(1)}`);
  const bot = [...cone].reverse().map((c) => `${x(c.tMin).toFixed(1)},${y(c.p10).toFixed(1)}`);
  const conePath = `M${top.join(" L")} L${bot.join(" L")} Z`;
  const medianPath = `M${cone.map((c) => `${x(c.tMin).toFixed(1)},${y(c.p50).toFixed(1)}`).join(" L")}`;
  return { W, H, padL, padR, y, x, conePath, medianPath, levels: levels.map((l) => ({ ...l, y: y(l.price) })) };
}
