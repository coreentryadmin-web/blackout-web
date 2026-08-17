/**
 * Step-by-step screenshot playbooks — babysitting operators through each desk.
 * Mirrors production UI selectors (x-showcase-post.mjs + desk components).
 */

import type { SocialContentArchetype } from "@/lib/largo/social-content-core";
import { LARGO_PLATFORM_LINKS } from "@/lib/largo/platform-links";

export type CapturePlaybookInput = {
  ticker: string;
  toolId: string;
  archetype?: SocialContentArchetype;
  /** Thermal compare grid instead of single-ticker matrix. */
  thermalPreset?: "mega" | "semis" | "indices" | null;
};

export type CapturePlaybook = {
  tool: string;
  deskPath: string;
  goal: string;
  steps: string[];
  screenshotTarget: string;
  verifyBeforeCapture: string;
};

function sym(ticker: string): string {
  return ticker.toUpperCase().replace(/SPXW/, "SPX");
}

export function helixCapturePlaybook(ticker: string, archetype?: SocialContentArchetype): CapturePlaybook {
  const s = sym(ticker);
  const dteNote =
    archetype === "win_recap" || archetype === "play_evolution"
      ? "Tap Quick → **0DTE** (ember chip) so every print is same-day."
      : "Optional: tap **0DTE** under Quick if the story is same-day options.";
  return {
    tool: "Helix",
    deskPath: LARGO_PLATFORM_LINKS.desks.helix,
    goal: `${s} options flow tape — only ${s} prints visible`,
    steps: [
      `Open ${LARGO_PLATFORM_LINKS.desks.helix} (sign in as premium if prompted).`,
      "Dismiss any onboarding overlay (Skip / Got it / Close).",
      `In the command bar, find **Symbol** → input \`#helix-ticker-search\`.`,
      `Type ${s} slowly (uppercase). Tab out or click away.`,
      `Wait until **every row** in the tape shows ${s} in the symbol column (up to ~45s). If you see "No prints for ${s}", that is still valid — capture the empty state honestly.`,
      dteNote,
      "Optional: tap **Whales** (purple) if the post is about a block/sweep.",
      "Optional: tap **Hide analytics** if the bottom analytics strip clutters the screenshot.",
      "Scroll the tape so 3–8 recent prints are visible with premiums/strikes.",
      "Screenshot the **HELIX desk panel** (`.helix-desk-terminal` or `.helix-pro-desk`) — not the whole browser chrome.",
    ],
    screenshotTarget: `Flow tape panel with ${s} filter active`,
    verifyBeforeCapture: `#helix-ticker-search value === "${s}" AND tape symbols all match ${s}`,
  };
}

export function thermalSinglePlaybook(ticker: string): CapturePlaybook {
  const s = sym(ticker);
  return {
    tool: "Thermal",
    deskPath: LARGO_PLATFORM_LINKS.desks.thermal,
    goal: `${s} GEX/VEX matrix at nearest expiry`,
    steps: [
      `Open ${LARGO_PLATFORM_LINKS.desks.thermal}.`,
      "Page loads on SPY by default — do NOT screenshot yet.",
      'Click **Change ticker** (combobox trigger) → search input **"Search any ticker"**.',
      `Type ${s} → pick ${s} from the listbox (#ticker-listbox).`,
      `Wait for the matrix to populate (no "NO OPTIONS CHAIN" / empty chain message). Off-hours may show last RTH snapshot — OK if labeled stale in post.`,
      "Toggle lens **GEX** (default) or **VEX** if the story is vanna/dealer charm.",
      "Ensure spot row + flip line + at least one wall label are visible.",
      "Screenshot **`.gex-heatmap-desk`** — full matrix + key levels rail.",
    ],
    screenshotTarget: `GEX heatmap desk for ${s}`,
    verifyBeforeCapture: `Ticker chip shows ${s}; matrix cells populated`,
  };
}

export function thermalMag7Playbook(): CapturePlaybook {
  return {
    tool: "Thermal",
    deskPath: LARGO_PLATFORM_LINKS.desks.thermal,
    goal: "Mag 7 compare grid — seven mega-cap gamma columns side-by-side",
    steps: [
      `Open ${LARGO_PLATFORM_LINKS.desks.thermal}.`,
      "Click toolbar **Grid** (sector compare toggle) — toolbar should show `thermal-grid-toolbar--on`.",
      'Open the sector preset dropdown (aria-label **"Sector compare preset"**) → select **Mag 7**.',
      "Wait for all seven columns (NVDA, AAPL, MSFT, GOOG, AMZN, META, TSLA) to finish loading.",
      "Optional: click ↻ **Refresh compare grids** if any column looks stale.",
      "Screenshot the **compare grid** — all seven 0DTE matrices visible in one frame.",
    ],
    screenshotTarget: "Thermal Mag 7 compare grid",
    verifyBeforeCapture: "Seven ticker columns with gamma cells — preset label Mag 7",
  };
}

export function vectorCapturePlaybook(ticker: string): CapturePlaybook {
  const s = sym(ticker);
  return {
    tool: "Vector",
    deskPath: `${LARGO_PLATFORM_LINKS.desks.vector}?ticker=${encodeURIComponent(s)}`,
    goal: `${s} 0DTE structure chart with wall beads`,
    steps: [
      `Open Vector with ticker in URL: ${LARGO_PLATFORM_LINKS.desks.vector}?ticker=${s}.`,
      "Wait for `.vector-chart-wrap` to render candles.",
      'Click **0DTE** horizon (`data-testid="vector-dte-0dte"`).',
      'Set timeframe **15m** (`#vector-tf-select` → 15).',
      "Wait ~5s for wall beads + gamma flip line to settle on the chart.",
      "Screenshot **only the chart wrap** (`.vector-chart-wrap`) — walls + spot + beads visible.",
    ],
    screenshotTarget: "Vector 0DTE 15m chart",
    verifyBeforeCapture: `Active ticker ${s}; 0DTE + 15m selected`,
  };
}

export function nighthawkCapturePlaybook(ticker: string): CapturePlaybook {
  const s = sym(ticker);
  return {
    tool: "Night Hawk",
    deskPath: LARGO_PLATFORM_LINKS.desks.nighthawk,
    goal: `${s} on 0DTE Command board — committed plan or live card`,
    steps: [
      `Open ${LARGO_PLATFORM_LINKS.desks.nighthawk} → default tab **0DTE Command**.`,
      "Wait for `.nh-v2-col-zerodte` cards to load (or 'Today's plays' empty state).",
      `Find the card whose header includes **${s}**.`,
      "Expand the play row (chevron) so strike, direction, entry, and live P&L show.",
      "If posting a win recap: capture while status is OPEN/HOLD with green P&L, or CLOSED with graded outcome.",
      "Screenshot the **single play card** (`.nh-v2-zerodte-card`) — not the whole page.",
    ],
    screenshotTarget: `Night Hawk 0DTE card · ${s}`,
    verifyBeforeCapture: `Card text includes ${s} and shows direction/strike`,
  };
}

export function slayerCapturePlaybook(): CapturePlaybook {
  return {
    tool: "SPX Slayer",
    deskPath: LARGO_PLATFORM_LINKS.desks.spxSlayer,
    goal: "SPX play engine + left GEX matrix rail",
    steps: [
      `Open ${LARGO_PLATFORM_LINKS.desks.spxSlayer}.`,
      "Wait for center play engine (phase, grade, gates) and left SPX GEX matrix rail.",
      "Ensure live SPX spot row visible in matrix ladder.",
      "Screenshot full desk viewport — matrix rail + play engine in one frame.",
    ],
    screenshotTarget: "SPX Slayer dashboard",
    verifyBeforeCapture: "SPX matrix + play engine loaded",
  };
}

export function meridianCapturePlaybook(ticker: string): CapturePlaybook {
  const s = sym(ticker);
  return {
    tool: "Meridian",
    deskPath: LARGO_PLATFORM_LINKS.desks.meridian,
    goal: `${s} earnings / macro intel with signal grid`,
    steps: [
      `Open ${LARGO_PLATFORM_LINKS.desks.meridian}.`,
      `Use the **search bar** (meridian-search-input) → type ${s} → jump to next ${s} event on timeline.`,
      "Click the event row to open detail panel.",
      "Wait for earnings report hero + signal grid (flow, thermal, dark pool pillars) to populate.",
      "Screenshot detail panel — verdict + financials + attachable signal cards.",
    ],
    screenshotTarget: `Meridian ${s} event detail`,
    verifyBeforeCapture: "Event detail loaded; ticker matches search",
  };
}

export function largoCapturePlaybook(ticker: string): CapturePlaybook {
  const s = sym(ticker);
  return {
    tool: "Largo",
    deskPath: LARGO_PLATFORM_LINKS.desks.largo,
    goal: `AI desk read for ${s} — verdict + levels`,
    steps: [
      `Open ${LARGO_PLATFORM_LINKS.desks.largo}.`,
      `Ask: "What's the ${s} setup — flow, gamma, and key levels?"`,
      "Wait for full answer (Verdict + structured cards).",
      "Screenshot the answer card including levels rail if present.",
    ],
    screenshotTarget: "Largo answer card",
    verifyBeforeCapture: "Assistant turn complete, not streaming",
  };
}

export function trackRecordCapturePlaybook(): CapturePlaybook {
  return {
    tool: "Track Record",
    deskPath: LARGO_PLATFORM_LINKS.trackRecord,
    goal: "Public graded win/loss stats",
    steps: [
      `Open ${LARGO_PLATFORM_LINKS.trackRecord}.`,
      "Wait for graded stats table / summary to load.",
      "Screenshot the section you cite in the post (win rate, recent grades).",
    ],
    screenshotTarget: "Track record stats",
    verifyBeforeCapture: "Graded counts visible — do not crop in fake precision",
  };
}

const PLAYBOOK_BUILDERS: Record<
  string,
  (input: CapturePlaybookInput) => CapturePlaybook | null
> = {
  helix: (i) => helixCapturePlaybook(i.ticker, i.archetype),
  thermal: (i) =>
    i.thermalPreset === "mega"
      ? thermalMag7Playbook()
      : thermalSinglePlaybook(i.ticker),
  vector: (i) => vectorCapturePlaybook(i.ticker),
  nighthawk: (i) => nighthawkCapturePlaybook(i.ticker),
  slayer: () => slayerCapturePlaybook(),
  meridian: (i) => meridianCapturePlaybook(i.ticker),
  largo: (i) => largoCapturePlaybook(i.ticker),
  track_record: () => trackRecordCapturePlaybook(),
};

export function buildCapturePlaybook(input: CapturePlaybookInput): CapturePlaybook | null {
  const fn = PLAYBOOK_BUILDERS[input.toolId];
  return fn ? fn(input) : null;
}

export function wantsMag7Thermal(corpus: string): boolean {
  return /\b(mag\s*7|mag7|mega\s*cap|magnificent\s*seven|aapl.*nvda.*msft)\b/i.test(corpus);
}

/** Full ordered workflow for platform showcase — all tools, pick best 4 for X carousel. */
export function platformShowcaseWorkflow(ticker = "SPX"): CapturePlaybook[] {
  const s = sym(ticker);
  const isSpx = s === "SPX";
  const base = [
    vectorCapturePlaybook(s),
    helixCapturePlaybook(s, "platform_showcase"),
    thermalSinglePlaybook(s),
  ];
  if (isSpx) {
    base.push(slayerCapturePlaybook(), nighthawkCapturePlaybook(s));
  } else {
    base.push(largoCapturePlaybook(s));
  }
  return base;
}
