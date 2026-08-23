import type { PlaybookId } from "@/features/spx/lib/playbook-registry";

/** Max fired-primary attempts per playbook per session (research governor). */
export function playbookSessionMaxTriggersPerPb(): number {
  const n = Number(process.env.PLAYBOOK_SESSION_MAX_TRIGGERS_PER_PB ?? "3");
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 3;
}

export type PlaybookSessionRiskInput = {
  playbook_id: PlaybookId | null;
  triggers_today_by_pb: ReadonlyMap<string, number>;
  desk: { vix?: number | null; polled_at?: string | null; as_of?: string | null; halt_channel_stale?: boolean; gex_walls?: unknown[] };
};

export type PlaybookSessionRiskResult = {
  block: string | null;
  size_multiplier: number;
  warnings: string[];
};

export function evaluatePlaybookSessionRisk(input: PlaybookSessionRiskInput): PlaybookSessionRiskResult {
  const warnings: string[] = [];
  let size_multiplier = 1;

  if (!input.playbook_id) {
    return { block: null, size_multiplier, warnings };
  }

  const count = input.triggers_today_by_pb.get(input.playbook_id) ?? 0;
  const max = playbookSessionMaxTriggersPerPb();
  if (count >= max) {
    return {
      block: `Playbook ${input.playbook_id} session trigger cap (${max}) — stand down until tomorrow`,
      size_multiplier: 0,
      warnings,
    };
  }

  return { block: null, size_multiplier, warnings };
}
