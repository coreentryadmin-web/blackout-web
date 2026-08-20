import test from "node:test";
import assert from "node:assert/strict";

import { formatDepthBlock } from "@/lib/largo/largo-depth";
import {
  REDUNDANT_BY_CONSTRUCTION,
  STRUCTURALLY_RENDERED,
} from "@/features/largo/answer/section-policy";

/**
 * Deep dive was generating thousands of characters the renderer discards.
 *
 * MEASURED ON PROD 2026-08-20 across 8 live Deep answers (the first complete paired run of the
 * day — earlier attempts died on the shared-Clerk-user bug fixed in #2403):
 *
 *     median 3,524 chars   median ~56s   max 4,201 chars / 103s
 *     rich=8 raw=0         every envelope parsed; the card UI always engaged
 *     cardLeak=false       `[fact]` never reached a rendered card
 *
 * The last line matters: the `[fact]` dump was NOT a UI defect. The parser consumes those markers.
 * The defect is VOLUME — of eight contract sections, only `Interpretation` and `Conflicts` reach
 * the page as prose. The rest are parsed into cards/chips or dropped, and `Bottom line` is
 * discarded outright on every single answer.
 *
 * 103s is not merely slow: `largoMemberRouteDeadlineMs()` is 100s, so that turn was past the point
 * where the route gives up and the member gets nothing.
 */

const DEEP = formatDepthBlock("deep");

test("REGRESSION: the model is told not to write the section that is always discarded", () => {
  // `Bottom line` is in REDUNDANT_BY_CONSTRUCTION — generated every turn, rendered never.
  assert.ok(
    REDUNDANT_BY_CONSTRUCTION.has("bottom line"),
    "precondition: the renderer still drops Bottom line"
  );
  assert.match(DEEP, /Do NOT write a "Bottom line" section/i);
  assert.match(DEEP, /dropped before render/i, "and must say WHY, not just forbid it");
});

test("every structurally-rendered section is named as structured, not prose", () => {
  // The prompt must agree with the renderer about which sections become UI. If they drift, the
  // model writes paragraphs into a card slot again and the volume comes straight back.
  for (const name of ["verdict", "facts", "confidence", "risk", "data"]) {
    assert.ok(STRUCTURALLY_RENDERED.has(name), `precondition: ${name} is structurally rendered`);
  }
  const structured = DEEP.slice(DEEP.indexOf("**STRUCTURED"), DEEP.indexOf("**Do NOT write"));
  for (const name of ["Verdict", "Facts", "Confidence", "Risk", "Data"]) {
    assert.match(structured, new RegExp(`\\*\\*${name}\\*\\*`), `${name} must be listed as structured`);
  }
});

test("the two sections that actually render as prose are named as prose", () => {
  const prose = DEEP.slice(DEEP.indexOf("**PROSE"), DEEP.indexOf("**STRUCTURED"));
  assert.match(prose, /\*\*Interpretation\*\*/);
  assert.match(prose, /\*\*Conflicts\*\*/);
  // Conflicts must stay omittable — a "no conflicts" heading is the documented way a three-section
  // answer becomes an eight-section one.
  assert.match(prose, /OMIT the heading entirely/i);
});

test("length targets are stated and sit under the measured baseline", () => {
  // The targets must actually be a cut. Prod median was 3,524; a "target" above that changes
  // nothing. Parsed from the prompt so the numbers cannot drift apart from the prose.
  const single = Number(/\*\*(\d[\d,]*)-([\d,]+) characters\*\*/.exec(DEEP)?.[2]?.replace(/,/g, ""));
  const ceiling = Number(/may reach \*\*([\d,]+)\*\*/.exec(DEEP)?.[1]?.replace(/,/g, ""));
  assert.ok(Number.isFinite(single) && Number.isFinite(ceiling), "both targets must be stated");
  assert.ok(single < 3524, `single-fact target ${single} must undercut the 3,524 measured median`);
  assert.ok(ceiling < 3524, `even the play ceiling ${ceiling} must undercut it`);
  assert.ok(ceiling > single, "a play answer legitimately runs longer than a single fact");
});

test("scope discipline is stated in the same terms as Concrete", () => {
  // The measured failure was a flip question answered with flow, condor and confluence attached.
  assert.match(DEEP, /ANSWER ONLY WHAT WAS ASKED/i);
  assert.match(DEEP, /follow-up chips/i, "must point at where adjacent reads actually belong");
});

test("the contract itself is NOT abandoned", () => {
  // The sections are load-bearing: the terminal parses them into the cards. An answer that drops
  // them renders as flat text and loses the evidence, confidence and freshness UI entirely. This
  // change re-aims the contract, it does not remove it.
  assert.match(DEEP, /The terminal parses your sections/i);
  assert.match(DEEP, /Cite exact tool numbers/i);
  assert.doesNotMatch(DEEP, /do not use sections|no headings/i);
});
