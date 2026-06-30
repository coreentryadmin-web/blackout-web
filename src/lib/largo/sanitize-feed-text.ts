/**
 * Pure, alias-free sanitizer for untrusted external free-text (news titles/teasers,
 * web-search snippets, headlines) before it enters trusted contexts — either the
 * Largo system prompt or tool_result content returned to the model.
 *
 * It decodes HTML entities first (so &amp;amp; → &amp; not &amp;amp;), then strips line
 * breaks, code fences (backticks) and angle brackets so a crafted headline/snippet
 * cannot pose as instructions or open a fake markup/role block, then collapses runs
 * of whitespace and trims (LARGO-6 / prompt-injection hardening).
 *
 * Kept dependency-free and side-effect-free so it is trivially unit-testable
 * (tsx --test, relative import — no @/ alias needed).
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  trade: "™",
  reg: "®",
  copy: "©",
};

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec) =>
      String.fromCodePoint(parseInt(dec, 10))
    )
    .replace(/&([a-zA-Z]+);/g, (match, name) =>
      NAMED_ENTITIES[name.toLowerCase()] ?? match
    );
}

export function sanitizeFeedText(s: unknown): string {
  return decodeHtmlEntities(String(s ?? ""))
    .replace(/[\r\n]+/g, " ")
    .replace(/[`<>]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
