"use client";

import { useState, useEffect, useCallback } from "react";
import { clsx } from "clsx";
import { fetchHelixSignalOutcomes, type HelixSignalOutcomeRow, type HelixSignalOutcomeSummary } from "@/lib/api";
import {
  signalLedgerCopy,
  type HelixSignalLedgerStatus,
} from "@/features/helix/lib/helix-signal-ledger-status";
import { relativeAge } from "@/lib/relative-time";
import { Panel, Skeleton, EmptyState } from "@/components/ui";
import { MIN_GRADED_SAMPLE_FOR_WIN_RATE } from "@/features/helix/lib/helix-signal-outcome-summary";

const POLL_MS = 60_000;

function outcomeTone(outcome: string): { text: string; label: string } {
  switch (outcome) {
    case "continued": return { text: "text-bull", label: "CONTINUED" };
    case "reversed": return { text: "text-bear-text", label: "REVERSED" };
    case "flat": return { text: "text-sky-300", label: "FLAT" };
    default: return { text: "text-cyan-400", label: "PENDING" };
  }
}

function signalLabel(signalType: string): string {
  return signalType === "velocity_spike" ? "VELOCITY" : signalType === "split_flow" ? "SPLIT" : signalType.toUpperCase();
}

/**
 * Tier 2 item #10 (2026-08-02 Helix audit) — the follow-through tracker. Read-only over the
 * signal-outcome ledger Tier 2 item #9 writes; this is the FIRST surface where the audit's
 * sequencing-risk discipline has to hold: a win-rate is shown ONLY once
 * MIN_GRADED_SAMPLE_FOR_WIN_RATE graded rows exist (helix-signal-outcome-summary.ts) — below
 * that, the panel says "Collecting data" rather than a fabricated/noisy percentage. Individual
 * graded rows ARE shown regardless of sample size, since a single row's own real outcome is
 * honest history, not a claimed statistic.
 *
 * The SAME discipline applies one level up, and did not used to. With zero rows the panel asserted
 * "No velocity-spike or split-flow firings recorded yet this session" — a claim about the session,
 * made from a row count, which cannot see whether anything is recording at all. On production it
 * was false in both halves: the ledger's only writer is not deployed, and signals fire constantly
 * in the two radar panels beside this one. `helix-signal-ledger-status.ts` separates an EMPTY
 * ledger from an UNWRITTEN one, and a third state for "the server could not tell".
 */
export function SignalOutcomeTracker() {
  const [rows, setRows] = useState<HelixSignalOutcomeRow[]>([]);
  const [summary, setSummary] = useState<HelixSignalOutcomeSummary | null>(null);
  const [ledger, setLedger] = useState<HelixSignalLedgerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetchHelixSignalOutcomes();
      setRows(res.rows ?? []);
      setSummary(res.summary ?? null);
      setLedger(res.ledger ?? null);
      setErrored(false);
    } catch (e) {
      console.warn("[SignalOutcomeTracker] fetch error:", e);
      setErrored(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  return (
    <Panel
      accent="sky"
      title="Signal Outcomes"
      kicker="follow-through"
      className="helix-pro-rail-panel"
      bodyClassName="space-y-1.5"
    >
      {loading ? (
        <div className="space-y-1.5 py-1">
          {[1, 2, 3].map((n) => (
            <Skeleton key={n} height={30} rounded="md" />
          ))}
        </div>
      ) : errored ? (
        <p className="font-mono text-[10px] text-bear text-center py-3">Outcome ledger unavailable</p>
      ) : rows.length === 0 ? (
        // Three distinguishable facts, not one. The old copy said "Collecting data / No firings
        // recorded yet this session" for all of them — an assertion about the SESSION made from a
        // row count, which cannot see whether anything is recording at all. `ledger === null` is
        // the server declining to say; it gets the neutral wording, never either verdict.
        (() => {
          const copy = ledger ? signalLedgerCopy(ledger) : null;
          // "Not recording" is a defect report, not a quiet session, so it must not wear the same
          // neutral placeholder styling as one. Done with `className` — the shared `EmptyState`
          // has no tone prop and adding one from this lane would change every empty state in the
          // app to fix one panel.
          const notRecording = ledger?.state === "no_writer_observed";
          return (
            <EmptyState
              className={clsx(
                "!bg-transparent !py-6",
                notRecording ? "!border-amber-400/40" : "!border-transparent"
              )}
              title={copy?.title ?? "No graded firings"}
              description={
                copy?.description ??
                "No velocity-spike or split-flow outcomes are available to show."
              }
            />
          );
        })()
      ) : (
        <>
          <div className="flex items-center justify-between px-1 pb-1">
            <span className="font-mono text-[10px] text-sky-300/70">
              {summary?.gradedCount ?? 0} graded · {summary?.pendingCount ?? 0} pending
            </span>
            <span className="font-mono text-[11px] font-bold">
              {summary?.winRatePct != null ? (
                <span className={summary.winRatePct >= 50 ? "text-bull" : "text-bear-text"}>
                  {summary.winRatePct}% continued
                </span>
              ) : (
                <span className="text-cyan-400">
                  Collecting data ({summary?.gradedCount ?? 0}/{MIN_GRADED_SAMPLE_FOR_WIN_RATE})
                </span>
              )}
            </span>
          </div>
          <div className="space-y-1">
            {rows.slice(0, 12).map((r) => {
              const tone = outcomeTone(r.outcome);
              return (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] px-2.5 py-1.5"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-[11px] font-bold text-white">{r.ticker}</span>
                    <span className="font-mono text-[9px] text-purple-light">{signalLabel(r.signal_type)}</span>
                    <span className="font-mono text-[9px] text-sky-300/60">{relativeAge(r.fired_at)}</span>
                  </div>
                  <span className={clsx("font-mono text-[9px] font-bold shrink-0", tone.text)}>{tone.label}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Panel>
  );
}
