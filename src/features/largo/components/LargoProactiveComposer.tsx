"use client";

import useSWR from "swr";
import { clsx } from "clsx";
import type { LargoStatusResponse } from "@/features/largo/components/LargoStatusStrip";

const fetcher = (url: string) => fetch(url, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null));

export type ProactiveChip = {
  id: string;
  label: string;
  question: string;
  tone?: "conflict" | "brief" | "default";
};

function buildProactiveChips(data: LargoStatusResponse | null | undefined): ProactiveChip[] {
  if (!data) return [];
  const chips: ProactiveChip[] = [];

  if (data.toolConflict?.conflict) {
    chips.push({
      id: "conflict",
      label: "HELIX vs Thermal conflict",
      question: "Why do HELIX flow and Thermal GEX disagree on SPX right now — which desk should I trust?",
      tone: "conflict",
    });
  }

  const phase = (data.marketPhase ?? "").toLowerCase();
  if (phase.includes("pre") || phase.includes("open") || phase.includes("morning")) {
    chips.push({
      id: "morning-brief",
      label: "Morning brief",
      question: "Give me a morning brief — SPX structure, overnight flow, and what to watch first.",
      tone: "brief",
    });
  }

  if ((data.activeSignals ?? 0) > 0) {
    chips.push({
      id: "active-signals",
      label: `${data.activeSignals} active signals`,
      question: "Summarize the active signals across the desk — what matters most right now?",
    });
  }

  return chips.slice(0, 3);
}

export function LargoProactiveComposer({
  onAsk,
  disabled,
  className,
}: {
  onAsk: (question: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const { data } = useSWR<LargoStatusResponse | null>("/api/market/largo/status", fetcher, {
    refreshInterval: 45_000,
    revalidateOnFocus: true,
  });

  const chips = buildProactiveChips(data);
  if (!chips.length || disabled) return null;

  return (
    <div className={clsx("largo-proactive-chips", className)} role="group" aria-label="Suggested reads">
      {chips.map((chip) => (
        <button
          key={chip.id}
          type="button"
          className={clsx(
            "largo-proactive-chip",
            chip.tone === "conflict" && "largo-proactive-chip-conflict",
            chip.tone === "brief" && "largo-proactive-chip-brief"
          )}
          disabled={disabled}
          onClick={() => onAsk(chip.question)}
        >
          {chip.label}
        </button>
      ))}
    </div>
  );
}
