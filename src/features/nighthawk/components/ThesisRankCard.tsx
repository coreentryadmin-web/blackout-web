"use client";

import type { ThesisPipelineResult } from "@/lib/zerodte/thesis/types";
import { ARCHETYPE_LABEL } from "@/lib/zerodte/thesis/archetype";
import { THESIS_RAIL_ORDER } from "@/lib/zerodte/thesis/types";

type Props = {
  thesis: ThesisPipelineResult | null | undefined;
};

function fmtStrike(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** THESIS | EVIDENCE | CONTRACT | MANAGEMENT rank card for 0DTE Command. */
export function ThesisRankCard({ thesis }: Props) {
  if (!thesis) return null;

  const { thesis: merged, rank_tier, archetype_gates, expression } = thesis;
  const rails = THESIS_RAIL_ORDER.filter((r) => merged.rail_scores[r] != null);

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <section className="rounded-lg border border-cyan-400/20 bg-cyan-400/[0.04] p-2.5">
        <h4 className="font-mono text-[9px] uppercase tracking-widest text-cyan-300">Thesis</h4>
        <p className="mt-1 text-[12px] font-semibold text-white">
          {ARCHETYPE_LABEL[merged.trade_archetype]}
        </p>
        <p className="t-num mt-0.5 text-[11px] text-sky-200">
          {rank_tier} · {merged.systems_aligned} systems · score {merged.archetype_score}
        </p>
        {merged.structural_state && (
          <p className="mt-1 text-[10px] text-cyan-200">{merged.structural_state}</p>
        )}
      </section>

      <section className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-2.5">
        <h4 className="font-mono text-[9px] uppercase tracking-widest text-sky-300">Evidence</h4>
        <ul className="mt-1 space-y-0.5">
          {rails.length === 0 ? (
            <li className="text-[11px] text-sky-200">No rails fired</li>
          ) : (
            rails.map((r) => (
              <li key={r} className="flex justify-between gap-2 text-[11px]">
                <span className="text-white">{r}</span>
                <span className="t-num text-sky-200">{merged.rail_scores[r]}</span>
              </li>
            ))
          )}
        </ul>
        {archetype_gates.verdict !== "PASS" && (
          <p className="mt-1 text-[10px] text-cyan-300">
            Gate {archetype_gates.verdict}
            {archetype_gates.blocks.length ? ` · ${archetype_gates.blocks.join(", ")}` : ""}
          </p>
        )}
        {merged.disagreeing_rails.length > 0 && (
          <ul className="mt-1 space-y-0.5 border-t border-white/[0.06] pt-1">
            {merged.disagreeing_rails.map((d) => (
              <li key={`${d.rail}-${d.direction}`} className="flex justify-between gap-2 text-[10px]">
                <span className="text-cyan-300">
                  {d.rail} {d.direction.toUpperCase()} (opp)
                </span>
                <span className="t-num text-sky-200">{d.score}</span>
              </li>
            ))}
          </ul>
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

      <section className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-2.5">
        <h4 className="font-mono text-[9px] uppercase tracking-widest text-sky-300">Management</h4>
        <p className="mt-1 text-[11px] text-sky-100">
          Mechanical −50% stop · +100% trim target · hard exit 3:50 ET
        </p>
        <p className="t-num mt-1 text-[10px] text-sky-200">
          Tier {rank_tier} · {merged.direction.toUpperCase()} bias
        </p>
      </section>
    </div>
  );
}
