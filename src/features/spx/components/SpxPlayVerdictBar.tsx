"use client";

import { useMemo, useState } from "react";
import type { SpxPlayPayload } from "@/features/spx/lib/spx-play-engine";
import { buildPlayVerdictBarModel } from "@/features/spx/lib/spx-play-verdict-bar";
import { useSpxPinForecast } from "@/features/spx/hooks/useSpxPinForecast";

const C = {
  bg: "#0f151f",
  line: "#1e2836",
  ink: "#e7eef6",
  muted: "#7dd3fc",
  faint: "#38bdf8",
  call: "#a3e635",
  put: "#bf5fff",
  pin: "#ffd23f",
  warn: "#ff8a3d",
  mono: 'ui-monospace,"SF Mono",Menlo,Consolas,monospace',
};

type Props = {
  play: SpxPlayPayload | null;
  playLoading?: boolean;
  sessionActive?: boolean;
  /** iOS compact shell — collapsed by default to save scroll height on matrix tab. */
  compactDefaultCollapsed?: boolean;
};

export function SpxPlayVerdictBar({
  play,
  playLoading = false,
  sessionActive = true,
  compactDefaultCollapsed = false,
}: Props) {
  const [expanded, setExpanded] = useState(!compactDefaultCollapsed);
  const { pin } = useSpxPinForecast(sessionActive);
  const model = useMemo(
    () => buildPlayVerdictBarModel(play, { sessionActive, loading: playLoading, pin }),
    [play, sessionActive, playLoading, pin]
  );

  const dirColor =
    model.direction === "long" ? C.call : model.direction === "short" ? C.put : C.faint;
  const badgeColor =
    model.mode === "open"
      ? dirColor
      : model.mode === "watch"
        ? C.pin
        : model.mode === "hunting"
          ? C.faint
          : C.muted;

  const pnlColor =
    model.pnlTone === "up" ? C.call : model.pnlTone === "down" ? C.put : C.muted;

  const gatesClear = Boolean(play?.gates.passed);

  return (
    <div
      className="spx-play-verdict-bar"
      style={{
        border: `1px solid ${C.line}`,
        borderRadius: 12,
        background: C.bg,
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      <button
        type="button"
        className="spx-play-verdict-bar__head"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          padding: "10px 14px",
          border: "none",
          borderBottom: expanded ? `1px solid ${C.line}` : "none",
          background: "transparent",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 650, color: C.ink, letterSpacing: ".02em" }}>
            SPX <span style={{ color: dirColor }}>PLAY</span>
          </span>
          <span
            style={{
              fontFamily: C.mono,
              fontSize: 10.5,
              color: C.muted,
              border: `1px solid ${C.line}`,
              borderRadius: 5,
              padding: "1px 6px",
            }}
          >
            Slayer
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {model.pnlLabel && (
            <span style={{ fontFamily: C.mono, fontSize: 11.5, color: pnlColor, fontWeight: 600 }}>
              {model.pnlLabel}
            </span>
          )}
          <span
            style={{
              fontFamily: C.mono,
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: ".08em",
              color: badgeColor,
              border: `1px solid ${badgeColor}55`,
              borderRadius: 999,
              padding: "2px 8px",
              background: `${badgeColor}14`,
            }}
          >
            {model.badge}
          </span>
          <span style={{ fontFamily: C.mono, fontSize: 12, color: C.muted }} aria-hidden>
            {expanded ? "▾" : "▸"}
          </span>
        </div>
      </button>

      {!expanded ? (
        <div
          className="spx-play-verdict-bar__collapsed"
          style={{
            padding: "8px 14px 10px",
            fontFamily: C.mono,
            fontSize: 11.5,
            color: C.muted,
            lineHeight: 1.45,
            display: "flex",
            flexWrap: "wrap",
            gap: "4px 10px",
          }}
        >
          {model.contract && (
            <span style={{ color: dirColor, fontWeight: 600 }}>{model.contract}</span>
          )}
          {model.grade && model.score != null && (
            <span>
              Grade {model.grade} · {model.score}
            </span>
          )}
          <span style={{ color: C.ink, flex: "1 1 100%" }}>{model.statusLine}</span>
        </div>
      ) : (
        <div className="spx-play-verdict-bar__body" style={{ padding: "12px 14px 14px" }}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "baseline",
              gap: "6px 12px",
              marginBottom: 8,
            }}
          >
            {model.contract ? (
              <span style={{ fontFamily: C.mono, fontSize: 18, fontWeight: 650, color: dirColor }}>
                {model.direction === "long" ? "LONG" : model.direction === "short" ? "SHORT" : ""}{" "}
                {model.contract}
              </span>
            ) : model.direction ? (
              <span style={{ fontFamily: C.mono, fontSize: 16, fontWeight: 600, color: dirColor }}>
                {model.direction === "long" ? "LONG bias" : "SHORT bias"}
              </span>
            ) : null}
            {model.grade && (
              <span style={{ fontFamily: C.mono, fontSize: 12, color: C.muted }}>
                Grade {model.grade}
                {model.score != null ? ` · score ${model.score}` : ""}
              </span>
            )}
            {model.pnlLabel && (
              <span style={{ fontFamily: C.mono, fontSize: 13, fontWeight: 600, color: pnlColor }}>
                {model.pnlLabel}
              </span>
            )}
          </div>

          {model.levelsLine && (
            <div
              style={{
                fontFamily: C.mono,
                fontSize: 11.5,
                color: C.faint,
                marginBottom: 8,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {model.levelsLine}
            </div>
          )}

          <p
            style={{
              margin: 0,
              fontFamily: C.mono,
              fontSize: 12,
              color: C.ink,
              lineHeight: 1.5,
            }}
          >
            {model.statusLine}
          </p>

          {model.detailLine && (
            <p
              style={{
                margin: "8px 0 0",
                fontFamily: C.mono,
                fontSize: 11.5,
                color: C.muted,
                lineHeight: 1.45,
              }}
            >
              {model.detailLine}
            </p>
          )}

          {model.trimHint && (
            <div
              style={{
                marginTop: 10,
                padding: "6px 10px",
                borderRadius: 8,
                fontFamily: C.mono,
                fontSize: 11.5,
                color: C.pin,
                background: "rgba(255,210,63,.08)",
                border: "1px solid rgba(255,210,63,.35)",
              }}
            >
              {model.trimHint}
            </div>
          )}

          {model.gateCategories && model.mode !== "open" && (
            <div
              style={{
                marginTop: 10,
                padding: "8px 0",
                borderRadius: 8,
                fontFamily: C.mono,
                fontSize: 10,
              }}
            >
              <div style={{ marginBottom: 8 }}>
                <div
                  style={{
                    fontSize: 10.5,
                    fontWeight: 600,
                    color: C.ink,
                    marginBottom: 6,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  Gate Breakdown
                </div>
                {(["operational", "playbook_validity", "risk", "quality"] as const).map((cat) => {
                  const blocks = model.gateCategories![cat];
                  const catLabel =
                    cat === "operational"
                      ? "Market / Session"
                      : cat === "playbook_validity"
                        ? "Playbook Rules"
                        : cat === "risk"
                          ? "Risk Controls"
                          : "Data Quality";
                  const catColor =
                    cat === "operational"
                      ? C.warn
                      : cat === "playbook_validity"
                        ? C.put
                        : cat === "risk"
                          ? C.pin
                          : C.muted;

                  return (
                    <div
                      key={cat}
                      style={{
                        marginBottom: 6,
                        paddingLeft: 8,
                        borderLeft: `2px solid ${blocks.length > 0 ? catColor : "rgba(255,255,255,0.1)"}`,
                      }}
                    >
                      <div style={{ color: blocks.length > 0 ? catColor : C.muted, fontSize: 9.5, fontWeight: 600 }}>
                        {catLabel}
                        {blocks.length > 0 && ` (${blocks.length})`}
                      </div>
                      {blocks.map((msg, i) => (
                        <div
                          key={i}
                          style={{
                            fontSize: 9,
                            color: C.muted,
                            marginTop: 3,
                            lineHeight: 1.3,
                          }}
                        >
                          • {msg}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {model.gateLine && model.mode !== "open" && !model.gateCategories && (
            <div
              style={{
                marginTop: 10,
                padding: "6px 10px",
                borderRadius: 8,
                fontFamily: C.mono,
                fontSize: 11.5,
                color: gatesClear ? C.call : C.warn,
                background: gatesClear ? "rgba(163,230,53,.08)" : "rgba(255,138,61,.08)",
                border: gatesClear
                  ? "1px solid rgba(163,230,53,.35)"
                  : "1px solid rgba(255,138,61,.35)",
              }}
            >
              {gatesClear ? "Gates clear" : model.gateLine}
            </div>
          )}

          {model.mode === "open" && !model.signalCommitted && model.badge === "SIGNAL" && (
            <div
              style={{
                marginTop: 10,
                fontFamily: C.mono,
                fontSize: 11,
                color: C.warn,
              }}
            >
              Signal only — wait for committed OPEN before acting.
            </div>
          )}

          {model.alignHint && (
            <div
              style={{
                marginTop: 10,
                padding: "6px 10px",
                borderRadius: 8,
                fontFamily: C.mono,
                fontSize: 11,
                color: C.muted,
                background: "rgba(56,189,248,.06)",
                border: "1px solid rgba(56,189,248,.25)",
                lineHeight: 1.45,
              }}
            >
              {model.alignHint}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
