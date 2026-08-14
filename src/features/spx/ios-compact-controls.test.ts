import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

test("ios-native-compact-controls.css loaded from site layout", () => {
  const layout = readFileSync(join(root, "src/app/(site)/layout.tsx"), "utf8");
  assert.match(layout, /ios-native-compact-controls\.css/);
});

test("VectorToolbar exposes iOS compact scroll rows + desktop fallback row", () => {
  const src = readFileSync(join(root, "src/features/vector/components/VectorToolbar.tsx"), "utf8");
  assert.match(src, /vector-toolbar-row-primary/);
  assert.match(src, /vector-toolbar-row-secondary/);
  assert.match(src, /ios-compact-scroll-row/);
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

test("VectorCompareDesk grows grid slots dynamically (not always four)", () => {
  const src = readFileSync(join(root, "src/features/vector/components/VectorCompareDesk.tsx"), "utf8");
  assert.match(src, /gridSlotCount/);
  assert.match(src, /showAddSlot/);
  assert.doesNotMatch(src, /emptySlots/);
  assert.match(src, /data-pane-count=\{gridSlotCount\}/);
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
