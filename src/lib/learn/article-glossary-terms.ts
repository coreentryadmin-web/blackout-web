/**
 * Extracts {term, def} pairs directly from a glossary article's own markdown body, so a
 * DefinedTermSet built from this can never drift from what the page actually renders — the same
 * anti-drift discipline `glossaryTermsFlat()` documents for the platform glossary. A term defined
 * in structured data that the visible page doesn't show (or vice versa) is exactly the kind of
 * schema/markup mismatch Google penalizes.
 *
 * Matches the markdown convention every glossary article body already uses: one term per
 * paragraph, `**Term** — definition text`, optionally followed by inline `[links](/like-this)`
 * that MarkdownBody renders as anchors. JSON-LD `description` wants plain text, so inline links
 * are flattened to their anchor text and markdown emphasis markers are stripped.
 */
export function parseGlossaryTerms(body: string): { term: string; def: string }[] {
  const TERM_LINE = /^\*\*(.+?)\*\*\s+—\s+(.+)$/;
  const MARKDOWN_LINK = /\[([^\]]+)\]\([^)]+\)/g;

  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("**"))
    .map((line) => TERM_LINE.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({
      term: match[1].trim(),
      def: match[2].replace(MARKDOWN_LINK, "$1").replace(/\*/g, "").trim(),
    }));
}
