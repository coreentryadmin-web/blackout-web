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
