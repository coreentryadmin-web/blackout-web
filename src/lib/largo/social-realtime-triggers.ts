/**
 * Real-time social post triggers — ideas Largo can act on when data supports them.
 * Pure reference; every post still needs live tool confirmation this turn.
 */

export type SocialRealtimeTrigger = {
  id: string;
  label: string;
  when: string;
  tools: string[];
  archetype: string;
  hookAngle: string;
};

export const SOCIAL_REALTIME_TRIGGERS: SocialRealtimeTrigger[] = [
  {
    id: "flow_whale",
    label: "Whale print",
    when: "HELIX tape shows ≥$500k single print or whale chip lit",
    tools: ["Helix", "Thermal", "Vector"],
    archetype: "live_desk",
    hookAngle: "Someone just paid up for size — where are dealers positioned?",
  },
  {
    id: "zerodte_winner",
    label: "0DTE winner live",
    when: "Night Hawk / Grid play >+30% live P&L or fresh trim",
    tools: ["Night Hawk", "Helix", "Thermal"],
    archetype: "win_recap",
    hookAngle: "Desk caught it — show plan → flow → gamma, not just the P&L flex",
  },
  {
    id: "wall_break",
    label: "Gamma wall break",
    when: "Thermal/Vector regime event or spot through call/put wall",
    tools: ["Thermal", "Vector", "Helix"],
    archetype: "live_desk",
    hookAngle: "Wall was the line — spot just told you who was wrong",
  },
  {
    id: "flow_gex_conflict",
    label: "Flow vs gamma fight",
    when: "HELIX bias disagrees with Thermal regime on same ticker",
    tools: ["Helix", "Thermal", "Largo"],
    archetype: "live_desk",
    hookAngle: "Tape says one thing, dealers say another — which do you trust?",
  },
  {
    id: "earnings_30m",
    label: "Earnings imminent",
    when: "Meridian event ≤24h or same session for ticker on board",
    tools: ["Meridian", "Helix", "Thermal"],
    archetype: "live_desk",
    hookAngle: "Print in 30m — positioning + implied move, not a guess",
  },
  {
    id: "macro_cpi",
    label: "Macro catalyst",
    when: "Meridian high-impact macro (CPI, FOMC, NFP) within 48h",
    tools: ["Meridian", "Thermal SPX", "Vector SPX"],
    archetype: "morning_hook",
    hookAngle: "Event tomorrow — where gamma pins SPX into the number",
  },
  {
    id: "opex_week",
    label: "OpEx week",
    when: "Meridian opex event or monthly expiry cluster",
    tools: ["Meridian", "Thermal", "SPX Slayer"],
    archetype: "live_desk",
    hookAngle: "Pin mechanics into OpEx — max pain vs live walls",
  },
  {
    id: "mag7_heatmap",
    label: "Mag 7 gamma grid",
    when: "Semis/tech day — compare dealer gamma across mega caps",
    tools: ["Thermal Mag 7 grid", "Helix"],
    archetype: "platform_showcase",
    hookAngle: "Seven names, one gamma read — who is pinned vs who can run",
  },
  {
    id: "spx_open",
    label: "Cash open",
    when: "09:30–10:00 ET — Night Hawk levels vs first SPX Slayer phase",
    tools: ["Night Hawk", "SPX Slayer", "Vector"],
    archetype: "morning_hook",
    hookAngle: "Overnight plan vs the bell — did flip hold?",
  },
  {
    id: "track_record_milestone",
    label: "Graded milestone",
    when: "get_zerodte_record / track record shows fresh sample worth citing",
    tools: ["Track Record", "Night Hawk"],
    archetype: "track_record",
    hookAngle: "Honest W/L over N graded — sample size in the same breath",
  },
  {
    id: "play_evolution",
    label: "Play evolution thread",
    when: "Closed winner with visible Helix prints into the move",
    tools: ["Night Hawk", "Helix", "Thermal"],
    archetype: "play_evolution",
    hookAngle: "Three screenshots, one timeline — plan, flow, positioning",
  },
  {
    id: "discord_crosspost",
    label: "Discord → X recycle",
    when: "Strong desk read already shared in Discord — repackage for X",
    tools: ["Largo", "Copy for X"],
    archetype: "live_desk",
    hookAngle: "Same facts, tighter hook — link Discord in reply thread not main tweet",
  },
];

export function formatSocialTriggersBlock(): string {
  const lines = SOCIAL_REALTIME_TRIGGERS.map(
    (t) =>
      `- **${t.label}** (${t.id}): ${t.when} → tools: ${t.tools.join(", ")} · ${t.hookAngle}`,
  );
  return `## Real-time post triggers (check live data — never post from this list alone)\n${lines.join("\n")}`;
}
