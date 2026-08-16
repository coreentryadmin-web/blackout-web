import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

test("ios-native-compact-controls.css loaded for iOS shell only", () => {
  const loader = readFileSync(join(root, "src/components/ios/IosNativeStylesLoader.tsx"), "utf8");
  const layout = readFileSync(join(root, "src/app/(site)/layout.tsx"), "utf8");
  assert.match(loader, /ios-native-compact-controls\.css/);
  assert.match(layout, /IosNativeStylesLoader/);
  assert.doesNotMatch(layout, /ios-native-compact-controls\.css/);
});

test("VectorToolbar exposes iOS compact scroll rows + desktop fallback row", () => {
  const src = readFileSync(join(root, "src/features/vector/components/VectorToolbar.tsx"), "utf8");
  assert.match(src, /vector-toolbar-row-primary/);
  assert.match(src, /vector-toolbar-row-secondary/);
  assert.match(src, /ios-compact-scroll-row/);
  assert.match(src, /VectorBeadRailToggle/);
});

test("VectorToolbar compare pane uses slim single-row toolbar", () => {
  const src = readFileSync(join(root, "src/features/vector/components/VectorToolbar.tsx"), "utf8");
  assert.match(src, /comparePane/);
  assert.match(src, /vector-toolbar--compare-pane/);
});

test("compare pane CSS flex chain targets fillHost canvas", () => {
  const css = readFileSync(join(root, "src/app/globals.css"), "utf8");
  assert.match(css, /\.vector-compare-grid\[data-pane-count="2"\]/);
  assert.match(css, /\.vector-compare-grid\[data-pane-count="3"\]/);
  assert.match(css, /\.vector-compare-grid\[data-pane-count="4"\]/);
  assert.match(css, /data-pane-count="3"\][\s\S]*:nth-child\(1\)[\s\S]*grid-row: 1 \/ -1/);
  assert.match(css, /vector-toolbar-compare-row/);
});

test("VectorCompareDesk grid uses live chart count only (add symbol in command bar)", () => {
  const desk = readFileSync(join(root, "src/features/vector/components/VectorCompareDesk.tsx"), "utf8");
  assert.match(desk, /gridSlotCount = seeds\.length/);
  assert.match(desk, /canAddSymbol/);
  assert.doesNotMatch(desk, /vector-compare-slot-empty/);
  assert.match(desk, /data-pane-count=\{gridSlotCount\}/);
  const bar = readFileSync(join(root, "src/features/vector/components/VectorCompareCommandBar.tsx"), "utf8");
  assert.match(bar, /vector-compare-command-add/);
  assert.match(bar, /VectorCompareAddSlot/);
  assert.match(bar, /variant="header"/);
});

test("VectorCompareCommandBar shows chart count without a /4 cap label", () => {
  const src = readFileSync(join(root, "src/features/vector/components/VectorCompareCommandBar.tsx"), "utf8");
  assert.match(src, /paneCount === 1 \? "chart" : "charts"/);
  assert.doesNotMatch(src, /VECTOR_COMPARE_MAX_PANES/);
});

test("compare focus mode keeps panes mounted with hero + rail CSS", () => {
  const css = readFileSync(join(root, "src/app/globals.css"), "utf8");
  assert.match(css, /\.vector-compare-grid\.is-focus-expanded/);
  assert.match(css, /\.vector-compare-pane\.is-focus-rail[\s\S]*\.vector-compare-pane-body[\s\S]*display: none/);
  const desk = readFileSync(join(root, "src/features/vector/components/VectorCompareDesk.tsx"), "utf8");
  assert.match(desk, /focusExpanded/);
  assert.match(desk, /enterFocusExpand/);
  assert.match(desk, /Escape/);
});

test("compare panes hide volume sub-pane for taller beads", () => {
  const pane = readFileSync(join(root, "src/features/vector/components/VectorComparePane.tsx"), "utf8");
  assert.match(pane, /hideVolumePane/);
  const chart = readFileSync(join(root, "src/features/vector/components/VectorChart.tsx"), "utf8");
  assert.match(chart, /hideVolumePaneRef/);
  assert.match(chart, /hideVolumePaneRef\.current\)/);
});

test("compare panes use compact bead profile", () => {
  const pane = readFileSync(join(root, "src/features/vector/components/VectorComparePane.tsx"), "utf8");
  assert.match(pane, /compareCompactBeads/);
  const core = readFileSync(join(root, "src/features/vector/lib/vector-wall-rail-core.ts"), "utf8");
  assert.match(core, /BEAD_TUNING_COMPARE/);
  const primitive = readFileSync(join(root, "src/features/vector/lib/vector-wall-rail-primitive.ts"), "utf8");
  assert.match(primitive, /profile === "compare" \? "bottom"/);
});

test("compare linked crosshair sync wiring", () => {
  const desk = readFileSync(join(root, "src/features/vector/components/VectorCompareDesk.tsx"), "utf8");
  assert.match(desk, /handleCompareCrosshair/);
  assert.match(desk, /handleCompareVisibleRange/);
  assert.match(desk, /compareSync=/);
  const chart = readFileSync(join(root, "src/features/vector/components/VectorChart.tsx"), "utf8");
  assert.match(chart, /setCrosshairPosition/);
  assert.match(chart, /subscribeVisibleTimeRangeChange/);
});

test("compare linked replay uses command-bar transport when linked", () => {
  const desk = readFileSync(join(root, "src/features/vector/components/VectorCompareDesk.tsx"), "utf8");
  assert.match(desk, /hideReplayControls=\{linked\}/);
  assert.match(desk, /mergeReplayTimelines/);
  const bar = readFileSync(join(root, "src/features/vector/components/VectorCompareCommandBar.tsx"), "utf8");
  assert.match(bar, /vector-compare-command-replay/);
});

test("VectorReplayControls tags replay state for iOS collapse", () => {
  const src = readFileSync(join(root, "src/features/vector/components/VectorReplayControls.tsx"), "utf8");
  assert.match(src, /data-replay-active/);
});

test("CommandDeck wraps filter + sort in nh-deck-chrome-row", () => {
  const src = readFileSync(join(root, "src/features/nighthawk/command-deck/CommandDeck.tsx"), "utf8");
  assert.match(src, /nh-deck-chrome-row/);
});

test("compact controls use shrink-wrap flow-seg chips on iOS", () => {
  const css = readFileSync(join(root, "src/app/ios-native-compact-controls.css"), "utf8");
  assert.match(css, /flex: 0 0 auto/);
  assert.match(css, /overflow-x: auto/);
  assert.match(css, /--ios-compact-touch/);
});
