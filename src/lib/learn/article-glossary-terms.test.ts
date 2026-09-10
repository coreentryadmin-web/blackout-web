import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGlossaryTerms } from "./article-glossary-terms";
import { getArticle } from "./articles";

// Regression: /learn/options-trading-glossary rendered 24 real term definitions
// (`**Term** — definition`) as plain prose with zero machine-readable markup — no
// DefinedTermSet, unlike the platform's own /learn/glossary. A general options
// glossary is exactly the page a DefinedTermSet is for (Google definition boxes,
// AI-answer-engine extraction), so parseGlossaryTerms() derives the schema from the
// SAME body string the page renders, the same anti-drift discipline glossaryTermsFlat()
// documents for the platform glossary.

test("parseGlossaryTerms extracts every term from the real options-trading-glossary article", () => {
  const article = getArticle("options-trading-glossary");
  assert.ok(article, "options-trading-glossary article must exist");
  const terms = parseGlossaryTerms(article!.body);

  assert.ok(terms.length >= 20, `expected at least 20 terms, got ${terms.length}`);
  const names = terms.map((t) => t.term);
  for (const expected of ["0DTE (Zero Days to Expiration)", "GEX (Gamma Exposure)", "Gamma Flip", "Vega"]) {
    assert.ok(names.includes(expected), `missing term: ${expected}`);
  }
  for (const t of terms) {
    assert.ok(t.term.length > 0, "term must not be empty");
    assert.ok(t.def.length > 0, `${t.term} has an empty definition`);
  }
});

test("parseGlossaryTerms flattens inline markdown links to plain text", () => {
  const terms = parseGlossaryTerms(
    "**GEX** — Total dealer gamma. See [What Is GEX?](/learn/what-is-gex).",
  );
  assert.deepEqual(terms, [
    { term: "GEX", def: "Total dealer gamma. See What Is GEX?." },
  ]);
});

test("parseGlossaryTerms strips stray emphasis markers from the definition", () => {
  const terms = parseGlossaryTerms("**Theta** — Decays *fast* on 0DTE contracts.");
  assert.deepEqual(terms, [{ term: "Theta", def: "Decays fast on 0DTE contracts." }]);
});

test("parseGlossaryTerms ignores non-glossary prose lines", () => {
  const terms = parseGlossaryTerms(
    "Plain-English definitions of the terms you'll see across BlackOut.\n\n## Not a term\n\nJust a paragraph.",
  );
  assert.deepEqual(terms, []);
});
