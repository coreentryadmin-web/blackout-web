import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMarkdownTokens, tokenClass, type Token } from "./inline-markdown";

const kinds = (t: Token[]) => t.map((x) => `${x.kind}:${x.value}`);

test("bold is a TOKEN, not literal asterisks — the reported bug", () => {
  // Members saw `**Spot is above the gamma flip (71.74)**` printed with the asterisks in every
  // FACT and INFERENCE row, because the structured answer components rendered the raw string.
  const t = parseMarkdownTokens("**Earnings today after hours** is the catalyst.");
  assert.equal(t[0]!.kind, "bold");
  assert.equal(t[0]!.value, "Earnings today after hours");
  assert.ok(!kinds(t).some((k) => k.includes("**")), "no asterisk survives into a rendered token");
});

test("bold mid-sentence, and more than one per line", () => {
  const t = parseMarkdownTokens("IV is **historically compressed** and delta is **short**");
  const bold = t.filter((x) => x.kind === "bold").map((x) => x.value);
  assert.deepEqual(bold, ["historically compressed", "short"]);
});

test("italic and code are distinguished from bold", () => {
  assert.equal(parseMarkdownTokens("*soft*")[0]!.kind, "italic");
  assert.equal(parseMarkdownTokens("`SPXW260810P06500000`")[0]!.kind, "code");
  assert.equal(parseMarkdownTokens("**hard**")[0]!.kind, "bold");
});

test("numbers are highlighted so a figure reads the same in prose and in evidence", () => {
  const t = parseMarkdownTokens("Gamma flip 71.74 · call wall 80 · $4.9M stack · +7.69% intraday");
  const nums = t.filter((x) => x.kind === "num").map((x) => x.value);
  assert.ok(nums.includes("71.74"), nums.join("|"));
  assert.ok(nums.includes("$4.9M"));
  assert.ok(nums.some((n) => n.includes("7.69%")));
});

test("numbers INSIDE bold stay bold rather than splitting the emphasis", () => {
  // `**$4.9M total**` must render as one bold run. Splitting it would put an unstyled number in
  // the middle of a bold phrase, which looks like a rendering fault.
  const t = parseMarkdownTokens("**$4.9M total** across 213 fills");
  assert.equal(t[0]!.kind, "bold");
  assert.equal(t[0]!.value, "$4.9M total");
});

test("an UNCLOSED marker is left alone rather than eating the rest of the line", () => {
  // Real Largo output from the screenshot: `*Strike stacks (UW-verified, live feed):**`. A greedy
  // parser would swallow to the end of the line and hide content. Better to show one stray
  // asterisk than to lose the text.
  const t = parseMarkdownTokens("*Flow regime:**");
  const rendered = t.map((x) => x.value).join("");
  assert.ok(rendered.includes("Flow regime"), "the content must survive");
});

test("plain text passes through untouched", () => {
  const t = parseMarkdownTokens("Dark pool: no prints today");
  assert.equal(t.map((x) => x.value).join(""), "Dark pool: no prints today");
});

test("empty input is total", () => {
  assert.deepEqual(parseMarkdownTokens(""), []);
});

test("no token is ever emitted with its markers still attached", () => {
  // The property that actually matters: whatever the parser does with odd input, a marker must
  // never reach the DOM as visible text inside a styled token.
  for (const line of [
    "**a**",
    "*a*",
    "`a`",
    "**a** and *b* and `c`",
    "***a***",
    "**",
    "****",
    "a ** b",
    "**unclosed",
    "**multi word phrase with 71.74 inside**",
  ]) {
    for (const t of parseMarkdownTokens(line)) {
      if (t.kind === "bold" || t.kind === "italic") {
        assert.ok(!t.value.startsWith("*"), `${line} -> ${t.kind}:${t.value}`);
        assert.ok(!t.value.endsWith("*"), `${line} -> ${t.kind}:${t.value}`);
      }
      if (t.kind === "code") assert.ok(!t.value.includes("`"), line);
    }
  }
});

test("token classes are stable — the CSS depends on these names", () => {
  assert.equal(tokenClass("bold"), "largo-fmt-bold");
  assert.equal(tokenClass("italic"), "largo-fmt-italic");
  assert.equal(tokenClass("code"), "largo-fmt-code");
  assert.equal(tokenClass("num"), "largo-fmt-num");
  assert.equal(tokenClass("text"), "");
});

// ── Comma-grouped numbers: the class this tokeniser silently split for its whole life ──
//
// Nothing here existed before, which is why `7,500` rendered as text "7," + num "500" on every
// Largo answer surface. The three tests below are the three distinct harms, kept separate so a
// future regression says which one came back.

test("a comma-grouped number is ONE token — not the last three digits", () => {
  // The bug: the money branch accepts commas and the percent branch required a trailing `%`, so a
  // bare `7,500` matched neither and fell through to `\d{2,}` — which cannot match the lone `7`.
  // The engine skipped ahead and highlighted `500`.
  //
  // This is not a cosmetic miss. `.largo-fmt-num` is what the UI uses to say "this is the figure",
  // and on this desk 500 and 7,500 are different numbers, not different renderings of one.
  const t = parseMarkdownTokens("Sustained trade below 7,500 (loses the flip)");
  const nums = t.filter((x) => x.kind === "num").map((x) => x.value);
  assert.deepEqual(nums, ["7,500"], kinds(t).join(" | "));

  // And the separator must not be stranded in the text run either — a mid-number font switch is
  // how the split became VISIBLE ("7, 500"), since `.largo-fmt-num` is monospace and the body is not.
  assert.ok(
    !t.some((x) => x.kind === "text" && /\d,$/.test(x.value)),
    `a text token still ends in a dangling separator: ${kinds(t).join(" | ")}`,
  );
});

test("a multi-group number is not split into several numbers", () => {
  // `1,234,567` used to emit TWO num tokens, `234` and `567` — two highlighted figures where the
  // answer stated one.
  const nums = parseMarkdownTokens("1,234,567 contracts")
    .filter((x) => x.kind === "num")
    .map((x) => x.value);
  assert.deepEqual(nums, ["1,234,567"]);
});

test("commas compose with sign, decimals and percent rather than defeating them", () => {
  const one = (s: string) =>
    parseMarkdownTokens(s)
      .filter((x) => x.kind === "num")
      .map((x) => x.value);

  assert.deepEqual(one("VWAP 7,498.36"), ["7,498.36"]); // decimal tail survives
  assert.deepEqual(one("-1,205.50 net"), ["-1,205.50"]); // leading sign survives
  assert.deepEqual(one("up 12,000%"), ["12,000%"]); // percent is consumed, not clipped to `12`
  assert.deepEqual(one("$1,250 premium"), ["$1,250"]); // the money branch still wins first
});

test("the comma branch does not lower the bare-integer floor", () => {
  // `\d{2,}` deliberately leaves 1-digit integers unhighlighted, so ordinary prose ("3 plays")
  // is not littered with underlines. The comma branch uses `(?:,\d{3})+` — one or MORE — precisely
  // so it cannot match a bare `7` and undo that. If someone relaxes it to `*`, this fails.
  const nums = (s: string) =>
    parseMarkdownTokens(s)
      .filter((x) => x.kind === "num")
      .map((x) => x.value);

  assert.deepEqual(nums("3 plays"), []);
  assert.deepEqual(nums("7 and 12 only"), ["12"]);
});
