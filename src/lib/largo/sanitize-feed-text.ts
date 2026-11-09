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

/** Decode common HTML entities for display (news headlines, catalyst titles). */
export function decodeHtmlEntities(s: string): string {
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
  // A plain `String(s ?? "")` coerces ANY value, including objects/arrays — a malformed feed row
  // whose title/teaser/headline arrived as a nested object instead of a string (a mis-shaped
  // provider response, not a type-system violation: this function's own signature is `unknown`)
  // would silently stringify to the literal "[object Object]" (or "1,2,3" for an array), which a
  // panel or the model would then render as if it were real text. `meridian-feed-text.ts` already
  // had to wrap this function in its own `typeof value !== "string"` guard to avoid exactly that —
  // its own comment flags that "the same hole exists on the Largo side" where several call sites
  // (e.g. `largo-live-feed.ts`'s `o.teaser` line) call this function directly with no such guard.
  // Close it here, at the shared boundary, so every caller is protected, not just the ones that
  // remembered to add their own type check. Primitives (number/boolean) still coerce via String()
  // below — that is the pre-existing, intentionally unit-tested contract (sanitizeFeedText(42) ->
  // "42"); only non-null objects (plain objects AND arrays) are blanked to "".
  const safe = s !== null && typeof s === "object" ? "" : s;
  return decodeHtmlEntities(String(safe ?? ""))
    .replace(/[\r\n]+/g, " ")
    .replace(/[`<>]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
