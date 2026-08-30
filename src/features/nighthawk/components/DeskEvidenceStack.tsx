"use client";

import {
  buildDeskEvidenceLines,
  countDeskAlignment,
  type DeskEvidenceLine,
  type DeskEvidenceStatus,
} from "@/lib/zerodte/thesis/desk-evidence-lines";
import type { ThesisPipelineResult } from "@/lib/zerodte/thesis/types";

type Props = {
  thesis: ThesisPipelineResult | null | undefined;
};

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
      return "is-aligned";
    case "opposed":
      return "is-opposed";
    case "neutral":
      return "is-neutral";
    default:
      return "is-unavail";
  }
}

function resolveDeskLines(thesis: ThesisPipelineResult): DeskEvidenceLine[] {
  if (thesis.desk_evidence?.length) return thesis.desk_evidence;
  return buildDeskEvidenceLines({
    thesis: thesis.thesis,
    rank_tier: thesis.rank_tier,
  });
}

/** Vertical cross-desk evidence rows for the 0DTE Command panel (narrow rail). */
export function DeskEvidenceStack({ thesis }: Props) {
  if (!thesis) return null;

  const { thesis: merged, archetype_gates } = thesis;
  const deskLines = resolveDeskLines(thesis);
  const { aligned, available } = countDeskAlignment(deskLines);
  const disagreeing = merged.disagreeing_rails ?? [];

  return (
    <div className="nh-deck-evidence-stack" aria-label="Cross-desk evidence">
      <div className="nh-deck-evidence-stack__summary">
        <span className="nh-deck-evidence-stack__align">
          {aligned}/{available || deskLines.length} desks aligned
        </span>
        {merged.structural_state && (
          <span className="nh-deck-evidence-stack__state">{merged.structural_state}</span>
        )}
      </div>

      <ul className="nh-deck-evidence-stack__list">
        {deskLines.map((line) => (
          <li key={line.desk} className={`nh-deck-evidence-stack__row ${statusClass(line.status)}`}>
            <span className="nh-deck-evidence-stack__desk">{line.desk}</span>
            <span className="nh-deck-evidence-stack__text">{line.text}</span>
            {line.status !== "unavailable" && (
              <span className="nh-deck-evidence-stack__chip">{statusLabel(line.status)}</span>
            )}
          </li>
        ))}
      </ul>

      {disagreeing.length > 0 && (
        <div className="nh-deck-evidence-stack__fracture">
          <div className="nh-deck-evidence-stack__fracture-hd">Fracture</div>
          <ul className="nh-deck-evidence-stack__fracture-list">
            {disagreeing.map((d) => (
              <li key={`${d.rail}-${d.direction}`}>
                {d.rail} {d.direction.toUpperCase()} · {d.summary}
              </li>
            ))}
          </ul>
        </div>
      )}

      {archetype_gates.verdict !== "PASS" && (
        <p className="nh-deck-evidence-stack__gate">
          Gate {archetype_gates.verdict}
          {archetype_gates.blocks.length ? ` · ${archetype_gates.blocks.join(", ")}` : ""}
        </p>
      )}
    </div>
  );
}
