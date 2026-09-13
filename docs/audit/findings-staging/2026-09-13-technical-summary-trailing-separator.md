> **kind:** FINDING

## Night Hawk Legacy — `buildTechnicalCard`'s `summary` field left a dangling "trend · " when `setup_tags` was legitimately empty — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P3 (text-quality/cosmetic, not a grading or member-money-facing bug) |
| **Lane** | Night Hawk Legacy |
| **Found** | 2026-09-13, aggressive improvement-hunting sweep per the standing v3 mandate |

### What was broken

`technicals.ts`'s `classifySetup()` was deliberately fixed on 2026-07-28 (see the existing test
`classifySetup: returns an empty array (not a sentinel string) when nothing matches`) to return
`[]` instead of a `["no dominant pattern"]` sentinel string — specifically so callers "fall
through cleanly" to trend-only or generic-setup prose when nothing matched, per that fix's own
comment.

`buildTechnicalCard`'s `summary` field was never updated to actually implement that fallback. It
built the string as plain interpolation:

```ts
summary: `${mtf.trend_stack} · ${setupTags.slice(0, 4).join(" · ")}`,
```

When `setupTags` is `[]` (the exact legitimate state the 2026-07-28 fix produces whenever nothing
matches), `setupTags.slice(0,4).join(" · ")` is `""`, so the result is `"${trend_stack} · "` — a
dangling separator with nothing after it, e.g. `"mixed · "` with trailing whitespace and a bare
dot. This is a direct regression against the *intent* of the 2026-07-28 fix, one level removed: the
empty-array contract was fixed so callers COULD fall through cleanly, but this particular caller
never actually did.

### Reachability / evidence

This `summary` field feeds `format.ts`'s `formatTickerDossierText` (`Technicals: ${t.summary}`),
which is:
- rendered into the dossier text fed to the LLM prompt in `play-explainer.ts`'s
  `generatePlayExplanation` (the "Full Hawk Intel" deep-dive briefing, touched in the prior finding
  this same session — `2026-09-13-play-explainer-risk-signals-not-surfaced.md`), and
- built during the evening edition compose in `edition-builder.ts`.

An empty `setup_tags` is not a rare edge case — it is the documented, intended "nothing notable"
state for any name whose technicals don't trip a tag this cycle.

### Fix

Extracted a small pure helper, `buildTechnicalSummary(trendStack, setupTags)`, mirroring the
existing pattern of exporting `classifySetup` for direct testing rather than only exercising it
through the network-calling `buildTechnicalCard`. Returns the bare trend stack when `setupTags` is
empty, otherwise the same `"trend · tag1 · tag2..."` join as before (capped at 4 tags, unchanged).
`buildTechnicalCard` now also applies the same `?? "mixed"` fallback to `summary` that the
adjacent `trend` field already applied, avoiding a literal `"undefined · ..."` on a missing
`trend_stack` — reusing an existing fallback already in the file, not inventing new behavior.

### Evidence

RED→GREEN: 3 of 5 new subtests fail against pre-fix code (`buildTechnicalSummary` didn't exist).
Verified via `git stash` on `technicals.ts` alone, re-running the test file, then restoring. 5/5
pass post-fix. Full suite (Node 20): 14097/14097 pass, 0 fail, 3 skipped. `npx tsc --noEmit`: clean.

### Blast radius

One field (`TechnicalCard.summary`), two downstream consumers (`format.ts`'s
`formatTickerDossierText`, read by `edition-builder.ts` and `play-explainer.ts`). No schema/API
shape changed — this only changes the text content of an existing string field when `setup_tags`
is empty; the non-empty case is byte-identical to before (same join, same 4-tag cap).
