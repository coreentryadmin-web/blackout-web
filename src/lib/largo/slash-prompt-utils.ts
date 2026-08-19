/**
 * Client-safe slash prompt helpers — no server/cache imports.
 * Keep this file free of dynamic platform reads so terminal UI can import it.
 */

import type { LargoSlashCommand } from "@/lib/largo/slash-commands";

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
