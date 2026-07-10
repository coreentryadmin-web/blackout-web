#!/usr/bin/env node
/**
 * Remove SPX CSS rules whose root class tokens are not referenced in src/.
 * Restores compact active rules that prior perf passes dropped.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const CSS_PATH = join(ROOT, "src/app/globals.css");

const CLASS_RE = /spx-[a-z0-9][a-z0-9-]*/g;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      walk(p, out);
    } else if (/\.(tsx?|jsx?)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

const used = new Set();
for (const file of walk(join(ROOT, "src"))) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(CLASS_RE)) used.add(m[0]);
}
// Layout shell on dashboard page
used.add("spx-desk-shell-fill");

/** Prefixes / exact tokens with zero live desk usage — safe to drop entire rules. */
const DEAD = [
  "spx-sniper-page",
  "spx-sniper-bg",
  "spx-sniper-overlay",
  "spx-sniper-header",
  "spx-sniper-command-scan",
  "spx-sniper-command-glow",
  "spx-command-pulse",
  "spx-hero-tagline",
  "spx-hero-desk-tick",
  "spx-command-live",
  "spx-stat-pill-dark",
  "spx-stat-pill-glow",
  "spx-stat-pill-hot",
  "spx-sniper-header-inner",
  "spx-sniper-header-scan",
  "spx-sniper-hero",
  "spx-sniper-hero-grid",
  "spx-sniper-main",
  "spx-sniper-split",
  "spx-sniper-right-rail",
  "spx-structure-",
  "spx-technicals-",
  "spx-tech-",
  "spx-level-",
  "spx-open-play-",
  "spx-stage-detail-",
  "spx-trade-panel-compact-",
  "spx-chart-frame",
  "news-rail",
  "news-rail-scroll",
  "spx-left-stack",
  "gex-heatmap-extreme-pop",
  "spx-odte-floor-pivot",
  "spx-odte-matrix-label",
  "spx-odte-matrix-strike",
  "spx-odte-matrix-value",
  "spx-odte-matrix-level-row",
  "spx-odte-matrix-spot-blink",
  "spx-odte-matrix-spot-row",
  "spx-odte-matrix-spot-cell",
  "spx-odte-matrix-row--spot-on-strike",
  "spx-odte-matrix-live-spot",
  "spx-left-tape",
  "spx-tape-panel",
  "spx-tape-list",
  "spx-tape-empty",
  "spx-center-panels",
  "spx-intel-",
  "spx-sector-chip",
  "spx-stock-chip",
  "spx-panel-amber",
  "spx-panel-gold",
  "spx-panel-purple",
  "spx-panel-cyan",
  "spx-panel-teal",
  "spx-panel-violet",
  "spx-panel-rose",
  "spx-desk-panel-body",
  "spx-gex-ladder-",
  "spx-desk-list",
  "spx-desk-bias",
  "spx-sparkline",
  "spx-iv-bar",
  "spx-odte-bar",
  "spx-trade-confirmations",
  "spx-trade-confirmation-",
  "spx-hero-metric-blocks",
];

function isDeadToken(token) {
  if (token === "spx-stat-pill") return true;
  if (token === "spx-sniper-title") return true;
  if (token === "spx-odte-matrix-row" && !used.has("spx-odte-matrix-row")) {
    // base row wash — modifiers (--anchor etc.) are used; keep row td rules
    return false;
  }
  return DEAD.some((d) => (d.endsWith("-") ? token.startsWith(d) : token === d || token.startsWith(`${d}-`)));
}

function tokensFromSelector(sel) {
  const out = [];
  for (const m of sel.matchAll(CLASS_RE)) out.push(m[0]);
  return out;
}

function ruleIsDead(selector) {
  const tokens = tokensFromSelector(selector);
  if (tokens.length === 0) return false;
  return tokens.every(isDeadToken);
}

function parseBlocks(text) {
  const blocks = [];
  let i = 0;
  while (i < text.length) {
    const start = i;
    while (i < text.length && text[i] !== "{") {
      if (text[i] === "/" && text[i + 1] === "*") {
        const end = text.indexOf("*/", i + 2);
        i = end === -1 ? text.length : end + 2;
        continue;
      }
      i++;
    }
    if (i >= text.length) {
      blocks.push({ kind: "raw", text: text.slice(start) });
      break;
    }
    const selector = text.slice(start, i).trim();
    let depth = 0;
    let j = i;
    while (j < text.length) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") {
        depth--;
        if (depth === 0) {
          j++;
          break;
        }
      }
      j++;
    }
    blocks.push({ kind: "rule", selector, text: text.slice(start, j) });
    i = j;
  }
  return blocks;
}

function filterBlocks(blocks) {
  const kept = [];
  for (const b of blocks) {
    if (b.kind === "raw") {
      kept.push(b.text);
      continue;
    }
    const head = b.selector.split(",")[0].trim();
    if (head.startsWith("@media") || head.startsWith("@keyframes")) {
      const inner = b.text.slice(b.text.indexOf("{") + 1, b.text.lastIndexOf("}"));
      const innerBlocks = parseBlocks(inner);
      const filteredInner = filterBlocks(innerBlocks).join("");
      if (!filteredInner.trim()) continue;
      const open = b.text.slice(0, b.text.indexOf("{") + 1);
      const close = "}";
      kept.push(`${open}${filteredInner}${close}`);
      continue;
    }
    if (!ruleIsDead(head)) kept.push(b.text);
  }
  return kept;
}

const ACTIVE_RESTORE = `
  .spx-trade-alerts-shell {
    @apply flex flex-1 flex-col gap-2 min-h-0 overflow-hidden;
  }

  .spx-trade-alerts-panels--select {
    flex: 0 0 auto;
    max-height: 38%;
    min-height: 7.5rem;
  }

  .spx-play-select-row {
    @apply flex w-full flex-wrap items-baseline gap-x-1.5 gap-y-0.5 rounded-md border border-transparent bg-black/30 px-2 py-1.5 text-left transition-colors hover:border-white/15 hover:bg-black/50;
  }

  .spx-desk-session-strip {
    @apply flex items-start gap-2 shrink-0 rounded-lg border border-amber-400/25 bg-amber-400/[0.06] px-2.5 py-2;
  }

  .spx-desk-session-strip-dot {
    @apply mt-1 h-2 w-2 shrink-0 rounded-full bg-amber-400/70;
  }

  .spx-desk-session-strip-body {
    @apply font-mono text-[10px] leading-snug text-sky-300/85;
  }

  .spx-desk-closed-time {
    @apply text-amber-200/90 font-semibold;
  }

  /* ── SPX live commentary rail ── */
  .spx-commentary-rail {
    @apply flex flex-col rounded-2xl border border-purple/30 bg-black/55 backdrop-blur-md overflow-hidden flex-1 min-h-[280px];
    box-shadow: inset 0 0 50px rgba(191, 95, 255, 0.06);
  }

  .spx-commentary-rail-full {
    @apply xl:min-h-0 xl:h-full xl:max-h-[calc(100vh-240px)];
  }

  .spx-commentary-rail-desk {
    @apply min-h-0 flex flex-col h-full;
  }

  .spx-commentary-header {
    @apply flex items-center gap-3 shrink-0 px-5 py-4 border-b border-purple/20 bg-purple/5;
  }

  .spx-commentary-viewport {
    @apply flex-1 overflow-y-auto;
  }

  .spx-commentary-feed {
    @apply flex flex-col gap-4 p-4;
  }

  .spx-commentary-card {
    @apply border border-purple/25 bg-black/50 p-4 backdrop-blur-sm;
  }

  .spx-commentary-card-featured {
    @apply border-purple/45 bg-purple/[0.08] p-5;
    box-shadow: inset 0 0 60px rgba(191, 95, 255, 0.08);
  }

  .spx-commentary-bias {
    @apply text-[10px] font-syne uppercase tracking-[0.15em] px-2.5 py-1 border font-bold;
  }

  .spx-bias-bull { @apply border-bull/40 text-bull bg-bull/10; }
  .spx-bias-bear { @apply border-bear/40 text-bear bg-bear/10; }
  .spx-bias-neutral { @apply border-sky-300/30 text-sky-300; }

  .spx-commentary-changed {
    @apply space-y-0.5 list-none;
  }

  .spx-commentary-changed li {
    @apply font-mono text-[11px] text-bull/90 pl-3 border-l-2 border-bull/30 leading-relaxed;
  }

  .spx-commentary-body {
    @apply text-sm leading-relaxed space-y-2;
    color: #ffd23f;
    font-feature-settings: "kern" 1, "liga" 1;
  }

  .spx-ai-line {
    @apply leading-relaxed;
  }

  .spx-ai-label {
    @apply font-mono text-[15px] font-bold uppercase tracking-wide mr-2;
    color: #ffffff;
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .spx-ai-key {
    color: inherit;
    font-weight: 700;
  }

  .spx-ai-headline {
    color: #ffd23f;
  }

  .spx-ai-headline-bull {
    color: #00e676;
    text-shadow: 0 0 9px rgba(0, 230, 118, 0.40), 0 0 2px rgba(0, 230, 118, 0.70);
  }

  .spx-ai-headline-bear {
    color: #ff4d6d;
    text-shadow: 0 0 9px rgba(255, 77, 109, 0.40), 0 0 2px rgba(255, 77, 109, 0.70);
  }

  .spx-ai-headline-neutral {
    color: #38bdf8;
    text-shadow: 0 0 9px rgba(56, 189, 248, 0.40), 0 0 2px rgba(56, 189, 248, 0.70);
  }

  .spx-commentary-watch {
    @apply space-y-1 list-none;
  }

  .spx-commentary-watch li {
    @apply font-mono text-xs text-purple-light/95 leading-relaxed;
  }

  .spx-commentary-rail-standby {
    box-shadow:
      inset 0 0 80px rgba(191, 95, 255, 0.08),
      0 0 40px rgba(88, 28, 135, 0.15);
  }
`;

const css = readFileSync(CSS_PATH, "utf8");
const startMark = "/* ── SPX Sniper dashboard ── */";
const endMark = "/* ── Admin analytics dashboard ── */";
const start = css.indexOf(startMark);
const end = css.indexOf(endMark);
if (start === -1 || end === -1) {
  console.error("SPX section markers not found");
  process.exit(1);
}

const before = css.slice(0, start);
const section = css.slice(start, end);
const after = css.slice(end);

const blocks = parseBlocks(section);
const filtered = filterBlocks(blocks).join("");

// Drop duplicate restore snippets if already present
let merged = filtered;
if (!merged.includes(".spx-trade-alerts-shell")) {
  const insertAt = merged.indexOf(".spx-play-select-row--selected");
  if (insertAt !== -1) {
    merged = merged.slice(0, insertAt) + ACTIVE_RESTORE + merged.slice(insertAt);
  } else {
    merged += ACTIVE_RESTORE;
  }
}

// Collapse excessive blank lines
merged = merged.replace(/\n{3,}/g, "\n\n");

writeFileSync(CSS_PATH, before + merged + after);
console.log(`SPX CSS purge done. Used classes: ${used.size}. Section chars: ${section.length} -> ${merged.length}`);
