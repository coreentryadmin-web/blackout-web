import { truncateText } from "@/lib/truncate-text";
import { xPostFooterLine } from "@/lib/x-whop-link";
import type { PostType } from "@/lib/x-content-types";

/**
 * Trim a generated desk-post `content` string (body + its own trailing footer line) down
 * to X's 280-char limit, replacing that trailing line with a freshly-computed footer.
 *
 * BUG FIX (round 437): this was a FIFTH un-migrated copy of the exact truncation bug
 * `src/lib/truncate-text.ts`'s own header documents consolidating four others of
 * (`headlineFromMarkdown`, `x-content-humanize`, `generic-extract`, and
 * `conversation-history.ts`'s `conversationTitle`, PR #7642) — this file was simply
 * missed in the same sweep. It had BOTH of that shared bug's symptoms, and one of its
 * own:
 *   1. `body.slice(0, maxBody).trimEnd() + "…"` only trims trailing WHITESPACE before
 *      appending the ellipsis, never trailing punctuation — a body that happened to be
 *      cut right after a sentence's own full stop (or a comma/colon/dash) shipped as
 *      `…resistance.…` / `…flow, …` to the live X timeline, the identical "double
 *      punctuation" defect `truncate-text.ts` exists to prevent, uncaught by
 *      `isTweetContentValid`'s `BROKEN_PATTERNS` (none of which match this shape).
 *   2. No word-boundary backup — a hard cut mid-word (through an OCC symbol, a ticker,
 *      a number) read as a broken render rather than "there is more text".
 *   3. Worse than either of those: the ellipsis was appended UNCONDITIONALLY, even when
 *      `body` (post-footer-strip) already fit inside `maxBody` with room to spare and no
 *      truncation was needed at all — every post whose body only overflowed 280 chars
 *      because of its OWN trailing footer line (stripped via `content.slice(0, lastIndexOf
 *      ("\n"))` just above) got a spurious "…" tacked onto an otherwise-complete sentence.
 * `truncateText` already fixes all three: it only appends "…" when actually over budget,
 * backs up to a word boundary, and strips trailing punctuation first. See
 * `truncate-text.test.ts`'s own suite for that shared contract; this file no longer needs
 * its own beyond the regression below.
 *
 * Pulled out of `x-autopost/route.ts` into its own module (unchanged logic) so it can be
 * unit-tested directly — that route file's import graph drags in `server-only`-guarded
 * modules that `node:test` cannot load standalone.
 */
export function trimToLimit(content: string, postType: PostType): string {
  const footer = `\n${xPostFooterLine(postType)}`;
  const maxBody = 280 - footer.length - 1;
  if (content.length <= 280) return content;
  const body = content.slice(0, content.lastIndexOf("\n"));
  return truncateText(body, maxBody) + footer;
}
