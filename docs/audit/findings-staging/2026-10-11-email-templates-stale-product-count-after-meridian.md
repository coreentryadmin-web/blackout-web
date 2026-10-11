## Stale "five engines" preheaders in two Premium email templates, contradicting their own body copy — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | Email / marketing — `src/lib/email/templates/welcome-premium.ts`, `src/lib/email/templates/downgrade.ts` |
| **Severity** | P3 (member-visible copy bug, no functional/billing impact) |
| **Status** | FIXED |

### Root cause

Commit `5103e7f8d` (#3307, 2026-09-01, "7-product registry") added Meridian as BlackOut
Trades' 7th live product and bumped most of the hardcoded counts in these two email
templates accordingly — but missed each file's **preheader** string (the hidden preview
text `emailLayout` renders before the subject line), and `downgrade.ts`'s doc comment.
The result: a member opening either email saw one count in the inbox preview and a
contradicting one in the body.

- `welcome-premium.ts` (fires on becoming Premium): subject says "All seven products,
  live," the from-community opener says "the other six products," and the closing
  paragraph says "full seven-product desk" — but `sharedParagraphs` (the shared engine
  description) named only 5 engines with **Meridian completely absent**, and the
  preheader said *"Thermal, HELIX, Night Hawk, Largo AI, Vector — five more engines…"*
- `downgrade.ts` (fires on downgrading Premium→SPX Slayer): the body paragraph (line 19)
  correctly lists all 6 non-SPX-Slayer engines including Meridian and says "Six
  products, off your account as of now" — but the doc comment said "loses the other
  five engines" and the member-facing preheader said *"…five engines went dark."*

Not caught earlier because these templates only fire on a real billing event
(becoming/downgrading Premium), so very few people see any one of them, and there is
no dedicated test file for either — nothing exercises their rendered string content.

### Evidence

Direct `Read` of both files confirmed the exact contradicting strings quoted above.
`git show 5103e7f8d -- src/lib/email/templates/welcome-premium.ts` confirms this commit
touched the subject/opener/closing paragraph but not `sharedParagraphs` or the
preheader. A repo-wide `grep -rn "five engine\|other five\|five more\|five products"
src/lib/email/` found exactly these 3 occurrences across the 2 files — a closed set,
not a partial fix.

### Blast radius

Two files, three strings total:
- `welcome-premium.ts`: preheader (line 55) + a missing Meridian sentence in
  `sharedParagraphs` (paragraph 2).
- `downgrade.ts`: doc comment (line 9) + preheader (line 33).

No other email template references a stale engine count — the same `grep` pattern
above covered the entire `src/lib/email/` directory, not just the two files already
suspected.

### Fix

- `welcome-premium.ts`: appended a Meridian-describing sentence to `sharedParagraphs`'
  second paragraph (matching the sentence-construction style of the adjacent Night
  Hawk/Largo AI/Vector sentences, drawing on `PRODUCT_MANIFEST.meridian`'s positioning
  copy without copying it verbatim), and updated the preheader to name all 6 engines
  and say "six more engines."
- `downgrade.ts`: updated the doc comment and preheader from "five engines" to "six
  engines," matching the body paragraph's already-correct "Six products" language.

Deliberately did **not** refactor either template to pull product names/counts
dynamically from `PRODUCT_MANIFEST`/`manifestProductCount()` — these templates
consistently use hand-written prose matched to house voice (as do the other,
already-correct parts of the same files), and introducing a dynamic-derivation
architecture here would be a bigger change than this bug warrants. A future product
addition will need the same manual string update this one missed; that tradeoff is
unchanged by this fix.

### Test

New `src/lib/email/templates/welcome-premium-downgrade-product-count.test.ts` (3
tests) asserts both templates' rendered HTML: preheader names Meridian / says "six
more engines" and never "five more engines" (welcome-premium), preheader agrees with
the body's "Six products" count (downgrade). Proven RED→GREEN via `git stash` to
revert to the pre-fix strings — all 3 tests failed against the buggy copy, passed once
restored.
