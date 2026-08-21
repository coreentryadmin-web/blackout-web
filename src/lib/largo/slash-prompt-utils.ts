/**
 * Client-safe slash prompt helpers — no server/cache imports.
 * Keep this file free of dynamic platform reads so terminal UI can import it.
 */

import type { LargoSlashCommand } from "@/lib/largo/slash-commands";
import type { SlashSubmoduleItem } from "@/lib/largo/slash-submodules";

export type SlashPrompt = {
  id: string;
  label: string;
  question: string;
  hint?: string;
  /** Live grounding snippet shown on the chip — must be real or omitted. */
  live?: string;
  rank: number;
};

export type SlashPromptsPayload = {
  desk: string;
  label: string;
  command: string;
  as_of: string;
  prompts: SlashPrompt[];
  /** Stable submodule catalog for Modules tab. */
  modules: SlashSubmoduleItem[];
  /** Open desk in browser — secondary action, not primary. */
  href: string | null;
};

/** Desk token from slash command → builder key. */
export function slashDeskKeyFromCommand(cmd: LargoSlashCommand): string | null {
  if (cmd.kind === "prompt") return null;
  if (cmd.id.startsWith("nav-")) return cmd.command;
  return cmd.command;
}

/** Filter prompt chips as the member types after `/helix …`. */
export function filterSlashPrompts(prompts: SlashPrompt[], args: string): SlashPrompt[] {
  const q = args.trim().toLowerCase();
  if (!q) return prompts;
  return prompts.filter(
    (p) =>
      p.label.toLowerCase().includes(q) ||
      p.question.toLowerCase().includes(q) ||
      (p.hint ?? "").toLowerCase().includes(q) ||
      (p.live ?? "").toLowerCase().includes(q)
  );
}

/** Args typed after the slash command token. */
export function slashArgsFromInput(input: string, command: string): string {
  const trimmed = input.trimStart();
  const prefix = `/${command}`;
  if (!trimmed.toLowerCase().startsWith(prefix.toLowerCase())) return "";
  return trimmed.slice(prefix.length).trimStart();
}

/**
 * Chip text for a HELIX skew figure.
 *
 * Lives here, in the pure utils module, because the chip builder in `slash-prompts.ts` imports
 * `product-reads`, whose graph reaches `server-only` and cannot be imported by a unit test — the
 * same reason the tape fetch options were extracted. An untestable render decision is how the
 * defect below reached a member-visible surface in the first place.
 *
 * `call_pct` became `number | null` when the HELIX tape stopped reporting a fabricated 50/50
 * balance for a tape it never measured. `slash-prompts.ts` carried `${session.call_pct ?? 50}`,
 * which was DEAD CODE while the value could not be null — and would have become live the moment
 * it could, putting that exact fabricated "50% calls" back on a chip. The guard on that chip is
 * `alert_count > 0`, so it fires precisely on an all-typeless tape: prints exist, none carry a
 * side, the skew is genuinely unmeasured.
 *
 * Returns null when there is nothing to say, so the caller OMITS the clause rather than
 * substituting a number.
 */
export function skewChipText(callPct: number | null | undefined): string | null {
  return callPct == null || !Number.isFinite(callPct) ? null : `${callPct}% calls`;
}

/** Session chip: "62% calls · 431 prints", or the honest form when skew was never measured. */
export function sessionSkewChip(callPct: number | null | undefined, alertCount: number): string {
  const skew = skewChipText(callPct);
  return skew ? `${skew} · ${alertCount} prints` : `${alertCount} prints · skew not measured`;
}
