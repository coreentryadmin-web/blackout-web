/**
 * Extract post-answer honesty caveats appended by largo-terminal (coherence, provenance,
 * cross-source). Render them as styled UI callouts — not raw markdown blockquotes in the prose.
 */

export type AnswerCaveat = {
  kind: "coherence" | "provenance" | "source-conflict" | "plan" | "verification" | "integrity" | "other";
  body: string;
};

const CAVEAT_PATTERNS: ReadonlyArray<{ kind: AnswerCaveat["kind"]; re: RegExp }> = [
  { kind: "coherence", re: /^>\s*\*\*These two parts of this answer disagree\.\*\*/i },
  { kind: "integrity", re: /^>\s*\*\*Data integrity hold\.\*\*/i },
  { kind: "provenance", re: /^>\s*\*\*Source note\.\*\*/i },
  { kind: "source-conflict", re: /^>\s*\*\*Sources disagree on/i },
  { kind: "plan", re: /^>\s*\*\*(?:Timeframe|Plan) note\.\*\*/i },
  { kind: "verification", re: /^>\s*\*\*(?:Grounding|Verification) note\.\*\*/i },
];

/** Split trailing blockquote caveats from the answer body. */
export function splitAnswerCaveats(markdown: string): { body: string; caveats: AnswerCaveat[] } {
  const lines = String(markdown ?? "").split("\n");
  const caveats: AnswerCaveat[] = [];
  let i = lines.length - 1;
  while (i >= 0) {
    const line = lines[i].trim();
    if (!line) {
      i--;
      continue;
    }
    if (!line.startsWith(">")) break;
    const start = i;
    while (i >= 0 && lines[i].trim().startsWith(">")) i--;
    const block = lines
      .slice(i + 1, start + 1)
      .map((l) => l.replace(/^>\s?/, ""))
      .join(" ")
      .trim();
    const kind = CAVEAT_PATTERNS.find((p) => p.re.test(lines[i + 1] ?? ""))?.kind ?? "other";
    if (block) caveats.unshift({ kind, body: block });
  }
  const body = lines.slice(0, i + 1).join("\n").trimEnd();
  return { body, caveats };
}
