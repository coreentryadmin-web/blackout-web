"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { clsx } from "clsx";
import { Badge } from "@/components/ui";
import { isFlowAnomalyRecent } from "@/components/flow-anomaly-recency";

// ── Types ────────────────────────────────────────────────────────────────────

type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

interface FlowAnomaly {
  id: string;
  detectedAt: string; // ISO
  type: string;
  ticker: string;
  detail: string;
  premium: number;
  direction: string;
  severity: Severity;
}

interface AnomaliesResponse {
  anomalies: FlowAnomaly[];
}

// ── Constants ────────────────────────────────────────────────────────────────

const POLL_MS = 20_000;

// ── Helpers ──────────────────────────────────────────────────────────────────

function severityTone(s: Severity): "bear" | "bull" | "sky" | "neutral" {
  if (s === "CRITICAL" || s === "HIGH") return "bear";
  if (s === "MEDIUM") return "sky";
  return "neutral";
}

/**
 * Which anomalies should still render given a set of previously-dismissed ids.
 *
 * Pulled out as a pure function so "dismiss" can be scoped to the SPECIFIC
 * anomalies on screen at the moment of the click, rather than a blanket
 * `dismissed: boolean` that also hides every anomaly that shows up later in
 * the same session — including a brand new, unrelated, possibly CRITICAL one
 * the member never had a chance to see or dismiss.
 */
export function visibleFlowAnomalies<T extends { id: string }>(
  anomalies: readonly T[],
  dismissedIds: ReadonlySet<string>,
): T[] {
  return anomalies.filter((a) => !dismissedIds.has(a.id));
}

// ── Component ────────────────────────────────────────────────────────────────

export function FlowAnomalyBanner() {
  const [anomalies, setAnomalies] = useState<FlowAnomaly[]>([]);
  // Ids of the anomalies that were on screen the last time "Dismiss" was
  // clicked — NOT a blanket "hide forever this session" flag. This lets a
  // genuinely new anomaly (different id) that the poll picks up later still
  // surface, instead of staying suppressed by a stale dismissal of a
  // completely different, possibly already-expired alert.
  const [dismissedIds, setDismissedIds] = useState<ReadonlySet<string>>(new Set());
  const inFlight = useRef(false);
  const pending = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) { pending.current = true; return; }
    inFlight.current = true;
    try {
      let runAgain = true;
      while (runAgain) {
        pending.current = false;
        try {
          const res = await fetch("/api/market/anomalies", { cache: "no-store" });
          if (res.ok) {
            const data: AnomaliesResponse = await res.json() as AnomaliesResponse;
            const recent = (data.anomalies ?? []).filter((a) => isFlowAnomalyRecent(a.detectedAt));
            setAnomalies(recent);
          }
        } catch {
          // silent — stale data preferred over error flash
        }
        runAgain = pending.current;
      }
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void load();
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  const visible = visibleFlowAnomalies(anomalies, dismissedIds);

  if (visible.length === 0) return null;

  const hasCritical = visible.some((a) => a.severity === "CRITICAL");

  return (
    <div
      className={clsx(
        "relative mb-4 rounded-xl border px-4 py-3",
        hasCritical
          ? "border-bear/40 bg-bear/[0.08]"
          : "border-gold/30 bg-gold/[0.06]",
      )}
      role="alert"
      aria-live="polite"
    >
      {/* Header row */}
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {/* Alert icon */}
          <span
            className={clsx(
              "font-mono text-[14px] leading-none",
              hasCritical ? "text-bear-text" : "text-gold",
              hasCritical && "animate-pulse",
            )}
            aria-hidden
          >
            ⚠
          </span>
          <span
            className={clsx(
              "font-mono text-[10px] uppercase tracking-[0.16em] font-semibold",
              hasCritical ? "text-bear-text" : "text-gold",
            )}
          >
            Flow Anomalies Detected
          </span>
          <span className="font-mono text-[9px] text-mute tabular-nums">
            ({visible.length})
          </span>
        </div>

        {/* Dismiss */}
        <button
          type="button"
          onClick={() => setDismissedIds(new Set(anomalies.map((a) => a.id)))}
          className="font-mono text-[9px] uppercase tracking-[0.14em] text-mute transition-colors hover:text-white"
          aria-label="Dismiss anomaly banner"
        >
          Dismiss
        </button>
      </div>

      {/* Anomaly list */}
      <ul className="flex flex-col gap-2">
        {visible.map((a) => (
          <li
            key={a.id}
            className={clsx(
              "flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg border px-3 py-2",
              a.severity === "CRITICAL"
                ? "border-bear/30 bg-bear/[0.07] animate-pulse"
                : "border-white/[0.06] bg-white/[0.025]",
            )}
          >
            {/* Severity badge */}
            <Badge tone={severityTone(a.severity)} size="sm">
              {a.severity}
            </Badge>

            {/* Ticker */}
            <span className="font-mono text-[12px] font-semibold text-white tabular-nums">
              {a.ticker}
            </span>

            {/* Direction chip */}
            <span
              className={clsx(
                "font-mono text-[10px] uppercase tracking-[0.1em]",
                a.direction?.toUpperCase() === "CALL" || a.direction?.toUpperCase() === "BULLISH"
                  ? "text-bull"
                  : "text-bear-text",
              )}
            >
              {a.direction}
            </span>

            {/* Detail text */}
            <span className="font-mono text-[11px] text-mute">
              {a.detail}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
