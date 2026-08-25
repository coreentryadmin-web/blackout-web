"use client";

import {
  buildDeskEvidenceLines,
  countDeskAlignment,
  type DeskEvidenceLine,
  type DeskEvidenceStatus,
} from "@/lib/zerodte/thesis/desk-evidence-lines";
import type { ThesisPipelineResult } from "@/lib/zerodte/thesis/types";
import { ARCHETYPE_LABEL } from "@/lib/zerodte/thesis/archetype";

type Props = {
  thesis: ThesisPipelineResult | null | undefined;
};

function fmtStrike(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function statusLabel(status: DeskEvidenceStatus): string {
  switch (status) {
    case "aligned":
      return "aligned";
    case "opposed":
      return "opp";
    case "neutral":
      return "mixed";
    default:
      return "—";
  }
}

function statusClass(status: DeskEvidenceStatus): string {
  switch (status) {
    case "aligned":
      return "text-cyan-300";
    case "opposed":
      return "text-rose-300";
    case "neutral":
      return "text-sky-200";
    default:
      return "text-sky-200";
  }
}

function resolveDeskLines(thesis: ThesisPipelineResult): DeskEvidenceLine[] {
  if (thesis.desk_evidence?.length) return thesis.desk_evidence;
  return buildDeskEvidenceLines({
    thesis: thesis.thesis,
    rank_tier: thesis.rank_tier,
  });
}

/** THESIS | EVIDENCE | CONTRACT | MANAGEMENT rank card for 0DTE Command. */
export function ThesisRankCard({ thesis }: Props) {
  if (!thesis) return null;

  const { thesis: merged, rank_tier, archetype_gates, expression } = thesis;
  const deskLines = resolveDeskLines(thesis);
  const { aligned, available } = countDeskAlignment(deskLines);
  const disagreeing = merged.disagreeing_rails ?? [];

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <section className="rounded-lg border border-cyan-400/20 bg-cyan-400/[0.04] p-2.5">
        <h4 className="font-mono text-[9px] uppercase tracking-widest text-cyan-300">Thesis</h4>
        <p className="mt-1 text-[12px] font-semibold text-white">
          {merged.ticker} · {merged.direction.toUpperCase()}
        </p>
        <p className="t-num mt-0.5 text-[11px] text-sky-200">
          {aligned}/{available || 5} desks aligned · {rank_tier}
        </p>
        <p className="mt-1 text-[11px] text-white">
          {ARCHETYPE_LABEL[merged.trade_archetype]}
        </p>
        {merged.structural_state && (
          <p className="mt-1 text-[10px] text-cyan-200">{merged.structural_state}</p>
        )}
      </section>

      <section className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-2.5 sm:col-span-2">
        <h4 className="font-mono text-[9px] uppercase tracking-widest text-sky-300">Evidence</h4>
        <ul className="mt-1 space-y-1">
          {deskLines.map((line) => (
            <li key={line.desk} className="grid grid-cols-[4.5rem_1fr] gap-2 text-[11px] leading-snug">
              <span className={`font-mono text-[10px] uppercase tracking-wide ${statusClass(line.status)}`}>
                {line.desk}
              </span>
              <span className="text-white">
                {line.text}
                {line.status !== "unavailable" && (
                  <span className={`ml-1.5 font-mono text-[9px] uppercase ${statusClass(line.status)}`}>
                    {statusLabel(line.status)}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
        {disagreeing.length > 0 && (
          <ul className="mt-2 space-y-0.5 border-t border-white/[0.06] pt-1.5">
            <li className="font-mono text-[9px] uppercase tracking-widest text-cyan-300">Fracture</li>
            {disagreeing.map((d) => (
              <li key={`${d.rail}-${d.direction}`} className="text-[10px] text-cyan-200">
                {d.rail} {d.direction.toUpperCase()} · {d.summary}
              </li>
            ))}
          </ul>
        )}
        {archetype_gates.verdict !== "PASS" && (
          <p className="mt-1.5 text-[10px] text-cyan-300">
            Gate {archetype_gates.verdict}
            {archetype_gates.blocks.length ? ` · ${archetype_gates.blocks.join(", ")}` : ""}
          </p>
        )}
      </section>

      <section className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-2.5">
        <h4 className="font-mono text-[9px] uppercase tracking-widest text-sky-300">Contract</h4>
        {expression?.contract ? (
          <>
            <p className="mt-1 text-[12px] font-semibold text-white">
              {fmtStrike(expression.contract.strike)}
              {expression.contract.side === "call" ? "C" : "P"} · {expression.dte_target}DTE
            </p>
            <p className="t-num mt-0.5 text-[10px] text-sky-200">{expression.rationale}</p>
            {expression.vol_rationale && (
              <p className="mt-1 text-[10px] text-cyan-200">{expression.vol_rationale}</p>
            )}
          </>
        ) : (
          <p className="mt-1 text-[11px] text-sky-200">
            {expression?.rationale ?? "Expression pending chain scan"}
          </p>
        )}
      </section>

      <section className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-2.5 lg:col-span-4">
        <h4 className="font-mono text-[9px] uppercase tracking-widest text-sky-300">Management</h4>
        <p className="mt-1 text-[11px] text-sky-100">
          Mechanical −50% stop · +100% trim target · hard exit 3:50 ET
        </p>
        <p className="t-num mt-1 text-[10px] text-sky-200">
          Tier {rank_tier} · {merged.systems_aligned} rails · score {merged.archetype_score}
        </p>
      </section>
    </div>
  );
}
