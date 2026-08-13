/**
 * First-class one-tap prompts for /terminal — the questions that previously 502'd or
 * needed cross-desk synthesis. Each carries a member-facing label and the exact question
 * Largo receives (may differ: compare intent triggers structured prefetch).
 */

export type LargoDeskPrompt = {
  id: string;
  label: string;
  hint: string;
  question: string;
  /** When true, server prefetches HELIX+Thermal compare card before the model runs. */
  compareCard?: boolean;
};

/** Compact chips in the composer and native terminal. */
export const LARGO_DESK_PROMPTS: LargoDeskPrompt[] = [
  {
    id: "spx-setup",
    label: "SPX setup",
    hint: "Structure, flip, walls, and what the desk is leaning on",
    question: "What's the SPX setup right now — flip, walls, and dealer positioning?",
  },
  {
    id: "flow-gex-conflict",
    label: "Flow vs GEX",
    hint: "HELIX net flow vs Thermal gamma regime side by side",
    question: "Compare HELIX flow vs Thermal GEX on SPX — where do they disagree?",
    compareCard: true,
  },
  {
    id: "zerodte-pnl",
    label: "0DTE board P&L",
    hint: "Open Night Hawk / 0DTE plays and live marks",
    question: "What's the 0DTE board P&L — open plays, marks, and any stopped positions?",
  },
];

/** Empty-state showcase — same three intents, phrased as questions. */
export const LARGO_DESK_EXAMPLE_PROMPTS: LargoDeskPrompt[] = LARGO_DESK_PROMPTS;

/** Legacy export shape for chips that only need the question string. */
export const LARGO_SUGGESTION_QUESTIONS = LARGO_DESK_PROMPTS.map((p) => p.question);

export function deskPromptById(id: string): LargoDeskPrompt | undefined {
  return LARGO_DESK_PROMPTS.find((p) => p.id === id);
}

export function questionWantsCompareCard(question: string): boolean {
  const q = question.toLowerCase();
  return (
    /\b(helix|flow)\b.*\b(thermal|gex|gamma)\b/i.test(q) ||
    /\b(thermal|gex|gamma)\b.*\b(helix|flow)\b/i.test(q) ||
    /\bflow vs gex\b/i.test(q) ||
    /\bwhere do (?:they|the systems) disagree\b/i.test(q)
  );
}
