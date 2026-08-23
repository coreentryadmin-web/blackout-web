"use client";

import { Fragment, type ReactNode } from "react";

/**
 * INLINE MARKDOWN for model-authored strings.
 *
 * THE BUG THIS FIXES. Largo writes `**Earnings today after hours**` inside an evidence line, and
 * the structured answer components rendered that string with `{e.text}` — so React printed the
 * asterisks literally. Members saw `**Spot is above the gamma flip (71.74)**` in the FACT and
 * INFERENCE rows of every answer. The prose path never had this problem because
 * LargoMessageBody tokenises markdown; the structured path, added later, did not, and the two
 * halves of the same answer rendered by different rules.
 *
 * WHY THIS IS A SEPARATE MODULE. The tokeniser already existed — module-private inside
 * LargoMessageBody. Copying it into the answer components would have produced a second
 * implementation that drifts, and the failure mode of drift here is subtle: two parts of one
 * answer formatting the same syntax differently. One implementation, both callers.
 *
 * WHY NOT A MARKDOWN LIBRARY. This text is model-authored, i.e. untrusted. This renderer emits
 * React elements and never HTML — there is no `dangerouslySetInnerHTML` and no parser that could
 * be coaxed into producing markup. A model cannot inject an element through it, only styled text.
 * That property is worth more here than full markdown support.
 *
 * Numbers are highlighted too, so a figure reads the same whether it arrives in prose or in a
 * structured evidence row.
 */

export type TokenKind = "text" | "bold" | "italic" | "code" | "num";
export type Token = { kind: TokenKind; value: string };

/**
 * Money, percentages, decimals, multi-digit integers and point counts.
 *
 * THE COMMA ALTERNATIVE IS LOAD-BEARING — do not fold it back into the `%` one. Before it existed,
 * a comma-grouped number was only matched when it carried a `$` or a `%`: the money branch accepts
 * commas, and the percent branch accepted them but REQUIRED the trailing `%`. A bare `7,500` matched
 * neither, fell through to `\d{2,}`, and that branch cannot match `7` (one digit) — so the engine
 * skipped to the `500` and tokenised the line as text `"7,"` + num `"500"`.
 *
 * Three harms, in ascending order of seriousness:
 *   1. `.largo-fmt-num` switches to a MONOSPACE face, so the number rendered in two different fonts
 *      with a visible gap — "7, 500".
 *   2. The underline marks what the UI considers "the figure". It marked **500** when the figure was
 *      **7,500** — and on this desk that is a different number, not a smaller one.
 *   3. `1,234,567` split into TWO highlighted numbers, `234` and `567`.
 *
 * This is every index level, strike, share count and contract count Largo prints — i.e. most of what
 * the desk talks about — across both the structured answer surfaces (`renderInlineMarkdown`) and the
 * prose chat path (`LargoMessageBody` via `parseMarkdownTokens`).
 *
 * THE REST OF THE TREE ALREADY KNEW. This was not a hard call anyone got wrong twice — the comma
 * idiom is present, correct, and identical in every other numeric matcher here: `grounding.ts`
 * (×2), `polygon.ts` (×3) and `grounding-guard.ts` (×3) all place `\d{1,3}(?:,\d{3})+` AHEAD of the
 * bare `\d+` alternative, and `verifier.ts`'s `extractNumericClaims` strips the separators outright
 * (`.replace(/(\d),(\d{3})\b/g, "$1$2")`) before it matches. So every CHECKER read `7500` while the
 * RENDERER displayed `500`. This file was the sole outlier, which is also why the fix is safe: it
 * adopts the tree's established shape rather than inventing one.
 *
 * Ordering and quantifiers, both deliberate: the comma branch sits ahead of the percent branch so
 * `12,000%` is consumed whole rather than being clipped to `12`; it uses `(?:,\d{3})+` (one or more,
 * not zero or more) so it cannot shadow bare 1–3 digit integers, which stay unhighlighted by design
 * — `\d{2,}` is what sets that floor, and making the group optional here would start underlining
 * every "7" and "12" in ordinary prose. `(?<!\d)` stops it matching mid-run inside a longer digit
 * string.
 */
export const NUM_RE =
  /(\$[\d,]+(?:\.\d+)?[kKmMbB]?|[\+\-]?(?<!\d)\d{1,3}(?:,\d{3})+(?:\.\d+)?%?|[\+\-]?\d{1,3}(?:,\d{3})*(?:\.\d+)?%|[\+\-]?\d+\.\d+|[\+\-]?\d{2,}|[\+\-]?\d+\s*(?:pts?|points?|bpm))/gi;

export function tokenizePlain(text: string): Token[] {
  if (!text) return [];
  const out: Token[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  NUM_RE.lastIndex = 0;
  while ((m = NUM_RE.exec(text)) !== null) {
    if (m.index > last) out.push({ kind: "text", value: text.slice(last, m.index) });
    out.push({ kind: "num", value: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", value: text.slice(last) });
  return out.length ? out : [{ kind: "text", value: text }];
}

export function parseMarkdownTokens(segment: string): Token[] {
  const out: Token[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(segment)) !== null) {
    if (m.index > last) out.push(...tokenizePlain(segment.slice(last, m.index)));
    const raw = m[0];
    if (raw.startsWith("**")) out.push({ kind: "bold", value: raw.slice(2, -2) });
    else if (raw.startsWith("*")) out.push({ kind: "italic", value: raw.slice(1, -1) });
    else out.push({ kind: "code", value: raw.slice(1, -1) });
    last = m.index + raw.length;
  }
  if (last < segment.length) out.push(...tokenizePlain(segment.slice(last)));
  return out;
}

export function tokenClass(kind: TokenKind): string {
  switch (kind) {
    case "bold":
      return "largo-fmt-bold";
    case "italic":
      return "largo-fmt-italic";
    case "code":
      return "largo-fmt-code";
    case "num":
      return "largo-fmt-num";
    default:
      return "";
  }
}

export function renderTokens(tokens: Token[]): ReactNode {
  return tokens.map((t, i) => {
    if (t.kind === "text") return <Fragment key={i}>{t.value}</Fragment>;
    return (
      <span key={i} className={tokenClass(t.kind)}>
        {t.value}
      </span>
    );
  });
}

/**
 * Render one line of model-authored text with inline formatting applied.
 *
 * Total: a null/undefined/empty input renders nothing rather than throwing, because these strings
 * are optional fields on a model-produced envelope and a missing `note` must not take down the
 * answer around it.
 */
export function renderInlineMarkdown(text: string | null | undefined): ReactNode {
  if (!text) return null;
  return renderTokens(parseMarkdownTokens(text));
}
