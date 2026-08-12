/**
 * Strip vendor/infra names from Largo answers before members see them.
 * Public surfaces must say *what* was read, not *who* provided it (architecture rule #1).
 */

const VENDOR_TOKEN =
  /\b(?:UW|Unusual\s*Whales|Polygon(?:\.io)?|Massive|Benzinga|Anthropic|Clerk|Whop|Redis|Postgres|AWS|ECS)\b/gi;

/** Replace vendor names in provenance parens and inline copy with neutral desk labels. */
export function sanitizeLargoMemberText(text: string): string {
  if (!text.trim()) return text;

  return text
    .replace(/\(([^()]*)\)/g, (full, inner: string) => {
      if (!VENDOR_TOKEN.test(inner)) {
        VENDOR_TOKEN.lastIndex = 0;
        return full;
      }
      VENDOR_TOKEN.lastIndex = 0;
      const cleaned = inner
        .replace(/\b(?:Unusual\s*Whales|UW)\b/gi, "flow tape")
        .replace(/\b(?:Polygon(?:\.io)?|Massive)\b/gi, "market data")
        .replace(/\bBenzinga\b/gi, "news feed")
        .replace(/\b(?:Redis|Postgres|AWS|ECS)\b/gi, "platform cache")
        .replace(/\b(?:Anthropic|Clerk|Whop)\b/gi, "platform")
        .replace(/\s{2,}/g, " ")
        .trim();
      return cleaned ? `(${cleaned})` : "";
    })
    .replace(/\bUnusual\s*Whales\b/gi, "flow tape")
    .replace(/\bUW-verified\b/gi, "desk-verified")
    .replace(/\bUW\b/g, "flow tape")
    .replace(/\bPolygon\b/gi, "market data")
    .replace(/\bMassive\b/gi, "market data")
    .replace(/\bBenzinga\b/gi, "news feed")
    .replace(/[^\S\n]{2,}/g, " ")
    .trim();
}
