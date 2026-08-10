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

/** Money, percentages, decimals, multi-digit integers and point counts. */
export const NUM_RE =
  /(\$[\d,]+(?:\.\d+)?[kKmMbB]?|[\+\-]?\d{1,3}(?:,\d{3})*(?:\.\d+)?%|[\+\-]?\d+\.\d+|[\+\-]?\d{2,}|[\+\-]?\d+\s*(?:pts?|points?|bpm))/gi;

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
