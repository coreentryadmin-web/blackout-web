# Ask Largo swing brief — Benzinga headlines leak raw HTML entities into "Catalysts & news" — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-LARGO-004 |
| **Area** | Night Hawk Swings / Ask Largo — Catalysts & news section |
| **Status** | FIXED |

## Symptom

**Live reproduction (2026-09-06, `SWING:NN`):** the "Catalysts & news" section of the live swing
play-brief rendered:

```
• 12 Information Technology Stocks Moving In Tuesday&#39;s Intraday Session
• NextNav Announces Agreement With Safran Electronics &amp; Defense To Demonstrate Interoperability…
```

`&#39;` and `&amp;` should read as `'` and `&` — Benzinga (via the Polygon-keyed
`/benzinga/v2/news` feed) returns HTML-entity-encoded titles, and nothing between the provider
read and the swing brief's section body decoded them.

## Root cause

`assembleEcosystemArsenal()` (`src/lib/bie/ecosystem-context.ts`) mapped
`reads.news.items[].headline` directly into `arsenal.news.headlines` with no decoding step.
`polygon-news.ts`'s own "HONESTY" doc comment is explicit that the provider layer keeps headlines
exactly as Benzinga returned them by design — decoding is a **display-consumer** responsibility,
not the provider's. `arsenal.news.headlines` has exactly one consumer, `catalystsAndNewsSection()`
in `src/lib/swing/play-brief-intel.ts`, and it never decoded either.

This is the same class of bug `src/lib/meridian/meridian-feed-text.ts` fixed for the Meridian desk
on 2026-08-21 (its own doc comment: *"The repo already had the fix and Meridian was not using it:
`sanitizeFeedText` has decoded these since the LARGO-6 hardening work"*) — that fix covered
Meridian's six fields but never touched this `ecosystem-context.ts` call site, which feeds the
swing brief instead.

## Fix

`assembleEcosystemArsenal()` now runs each headline through the already-vetted
`sanitizeFeedText()` (`src/lib/largo/sanitize-feed-text.ts` — the same decoder Largo tool
responses and the Meridian desk use) before it reaches `arsenal.news.headlines`. One decoder, one
place to fix, consistent with the existing pattern — no new sanitizer written.

## Evidence

- RED→GREEN: new test `assembleEcosystemArsenal: Benzinga headline HTML entities are decoded for
  display (live prod repro, NN 2026-09-06)` in `src/lib/bie/ecosystem-context.test.ts` — confirmed
  failing pre-fix (raw `&#39;`/`&amp;` survive), passing post-fix (via `git stash` isolating the
  fix, confirmed RED, then restored).
- `npx tsc --noEmit`: clean.
- `src/lib/bie/ecosystem-context.test.ts`: 32/32 pass.
- `src/lib/swing/*.test.ts` + `src/lib/bie/*.test.ts`: 1463/1463 pass.

## Blast radius

Single field (`arsenal.news.headlines`), single consumer (`catalystsAndNewsSection()`). Verified
via `grep -rn "arsenal?.news\|arsenal\.news"` that no other call site reads this field.
