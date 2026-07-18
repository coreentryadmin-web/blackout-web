/** Conviction grade → meter fill (0–100). */
export function convictionFillPct(conviction: string): number {
  const c = conviction.trim().toUpperCase();
  if (c === "A+") return 100;
  if (c === "A") return 88;
  if (c === "B") return 68;
  if (c === "C") return 48;
  return 36;
}

export type BriefingIntelSection = { title: string; body: string };

/** Split Hawk Intel prose on **Section title** lines into briefing cards. */
export function parseExplainSections(text: string): BriefingIntelSection[] {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const sections: BriefingIntelSection[] = [];
  let current: BriefingIntelSection | null = null;

  for (const line of lines) {
    const bold = line.match(/^\*\*(.+?)\*\*:?\s*(.*)$/);
    if (bold) {
      if (current) sections.push(current);
      const rest = bold[2]?.trim() ?? "";
      current = { title: bold[1].trim(), body: rest };
      continue;
    }
    if (current) {
      current.body = current.body ? `${current.body}\n${line}` : line;
    } else {
      sections.push({ title: "Briefing", body: line });
    }
  }
  if (current) sections.push(current);
  return sections;
}
