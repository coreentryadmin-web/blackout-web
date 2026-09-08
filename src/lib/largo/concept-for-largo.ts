import { lookupGlossary, BLACKOUT_GLOSSARY } from "@/lib/bie/glossary";

export function conceptForLargo(input: { term?: string; question?: string }) {
  const raw = String(input.term ?? input.question ?? "").trim();
  if (!raw) {
    return {
      found: false,
      error: "Pass `term` or `question` — e.g. 'gamma flip' or 'what is GEX'.",
    };
  }

  const hit = lookupGlossary(raw);
  if (hit) {
    return {
      found: true,
      term: hit.term,
      category: hit.category,
      aliases: hit.aliases,
      definition: hit.definition,
      source: "blackout_glossary",
    };
  }

  return {
    found: false,
    term: raw,
    note:
      "No glossary entry matched. Do not invent a definition — say the term is not in the BlackOut glossary and offer to read live desk data instead.",
    glossary_term_count: BLACKOUT_GLOSSARY.length,
  };
}
