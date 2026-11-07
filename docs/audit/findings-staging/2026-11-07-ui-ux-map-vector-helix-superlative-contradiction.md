> **kind:** FINDING

## 2026-11-07 — `docs/audit/UI-UX-MAP.md` §3/§5 made two directly contradictory superlative claims, and the component-count claim was also wrong on its own terms — FIXED (docs)

| **Status** | FIXED on `fix/cron-window-audit` (docs-only) |
| --- | --- |

**Symptom:** `docs/audit/UI-UX-MAP.md` is an unqualified, platform-wide inventory (its own charter:
"Living document — keep it current forever after; when it and the live product disagree, the
product wins and the map is a bug"), and it contained two superlative claims about "the platform"
that cannot both be true:

- §3 (Helix): *"`FlowFeed` (`src/features/helix/components/FlowFeed.tsx`, 1224 lines — **the
  largest single component on the platform**)."*
- §5 (Vector): *"`VectorChart.tsx` is 4978 lines, **the single largest file on the platform**."*

Both claims are unqualified ("the platform," not "the largest flow-tape component" or similar), so
only one of them can be correct — and it is not the Helix one. A straight `wc -l` across every
product's `components/` directory on current `main`:

```
5826 src/features/vector/components/VectorChart.tsx
4649 src/features/thermal/components/GexHeatmap.tsx
1626 src/features/nighthawk/components/ZeroDteBoard.tsx
1441 src/features/helix/components/FlowFeed.tsx
1086 src/features/vector/components/VectorPageShell.tsx
```

`VectorChart.tsx` is not just larger than `FlowFeed.tsx` — two other files (`GexHeatmap.tsx`,
`ZeroDteBoard.tsx`) are also bigger than `FlowFeed.tsx`, so the Helix claim was false by a wide
margin, not a close call that drifted with later edits. Nothing suggests this was ever true even
at the doc's original 2026-08-23 commit pin (`c53ce32ae`) — Thermal's `GexHeatmap.tsx` and Night
Hawk's `ZeroDteBoard.tsx` both predate this doc.

**A second, independent claim in the same section was also wrong, not just stale:** §5 said
Vector's 32 component files made it "largest product by component count." Counting every product's
`components/` directory the same way (`find src/features/<product>/components -name "*.tsx" |
wc -l`):

```
Night Hawk: 49   (components/ only — command-deck/ adds 17 more, not counted here)
Helix:      35
Vector:     40
Largo:      24
SPX Slayer: 21
Meridian:   18
Thermal:    14
```

Vector (now 40, was 32 at doc-write time) is not the largest by this doc's own later-stated count
for Helix (24 at write time, now 35) nor for Night Hawk (not enumerated in the doc, now 49) — so
the "largest product by component count" claim does not hold today and there is no evidence it
ever held at write time either (Helix's own count would have needed to stay ≤32, which §3 already
contradicts by stating 24 at the same commit — i.e. the comparison was asserted without actually
being checked against the sibling section three paragraphs away).

**Root cause:** each product section of this map was written independently (Helix in §3, Vector in
§5) without cross-checking superlative claims against the sections already written earlier in the
same document — the exact "present-tense claim never reconciled against a sibling section"
staleness shape this map's own file otherwise guards against for individual facts, just not for
comparisons spanning sections.

**Fix (docs-only):**
- §3: removed the false "the largest single component on the platform" clause from the `FlowFeed.tsx`
  coordinate line; updated its stale line count (1224 → 1441), and the two other Helix component
  line counts cited nearby (`HelixFlowTable.tsx` 541 → 595, `HelixMobileFlowTape.tsx` 303 → 326).
- §5: updated `VectorPageShell.tsx` (936 → 1086) and `VectorChart.tsx` (4978 → 5826) line counts and
  the component-file count (32 → 40); replaced "largest product by component count" with the
  correctly-scoped claim that `VectorChart.tsx` is the single largest *component file* on the
  platform (verified true, by a wide margin, against every product's `components/` directory this
  pass); added a dated `**CORRECTION, 2026-11-07**` paragraph naming both the contradiction and the
  component-count error, with the current cross-product counts, so a future reader can see what was
  wrong and why rather than re-discovering the same contradiction from scratch.
- §10 item 5: updated the one other stray reference to `VectorChart.tsx`'s line count (4978 → 5826)
  for internal consistency.

**Blast radius:** `docs/audit/UI-UX-MAP.md` only — no source files changed, no code behavior
affected. The underlying product facts this doc describes (which component is biggest, which
product has the most component files) were simply never correctly stated; fixing the doc changes
no runtime behavior.

**Evidence:**
```
wc -l src/features/vector/components/VectorChart.tsx src/features/vector/components/VectorPageShell.tsx
  5826 VectorChart.tsx
  1086 VectorPageShell.tsx

wc -l src/features/helix/components/FlowFeed.tsx src/features/helix/components/HelixFlowTable.tsx \
      src/features/helix/components/HelixMobileFlowTape.tsx
  1441 FlowFeed.tsx
   595 HelixFlowTable.tsx
   326 HelixMobileFlowTape.tsx

find src/features/vector/components -name "*.tsx" | wc -l    → 40
find src/features/helix/components -name "*.tsx" | wc -l     → 35
find src/features/nighthawk/components -name "*.tsx" | wc -l → 49
find src/features/thermal/components -name "*.tsx" | wc -l   → 14
find src/features/meridian/components -name "*.tsx" | wc -l  → 18

find src/features -name "*.tsx" | xargs wc -l | sort -rn | head -4
  5826 VectorChart.tsx
  4649 GexHeatmap.tsx (thermal)
  1626 ZeroDteBoard.tsx (nighthawk)
  1441 FlowFeed.tsx (helix)
```
Documentation-only change; no test file applies. `npx tsc --noEmit` run to confirm no incidental
breakage (docs change touches no `.ts`/`.tsx`).

Found via this round's lead C ("`UI-UX-MAP.md` §3/§5/§6 ... unverified component-line-count
claims") — same "read in full, cross-check present-tense claims against current source"
methodology that has already found real stale-docs hits on HELIX-MAP.md, THERMAL-MAP.md,
MERIDIAN-MAP.md, and VECTOR-MAP.md this session, now extended to a cross-section contradiction
inside UI-UX-MAP.md itself rather than a single section's own drift.
