/**
 * Dynamic slash prompts — live desk reads turned into askable questions.
 * Pure builders + async fetchers; no LLM.
 */

import { fmtPremium } from "@/lib/fmt-money";
import type { LargoSlashCommand } from "@/lib/largo/slash-commands";
import { submoduleItemsForDesk } from "@/lib/largo/slash-submodules";
import { deskScopeConfig } from "@/lib/largo/desk-scope";
export type { SlashPrompt, SlashPromptsPayload } from "@/lib/largo/slash-prompt-utils";
import type { SlashPrompt, SlashPromptsPayload } from "@/lib/largo/slash-prompt-utils";
import { skewChipText, sessionSkewChip } from "@/lib/largo/slash-prompt-utils";

function sortPrompts(prompts: SlashPrompt[]): SlashPrompt[] {
  return [...prompts].sort((a, b) => a.rank - b.rank).slice(0, 8);
}

function pushUnique(out: SlashPrompt[], p: SlashPrompt) {
  if (out.some((x) => x.id === p.id)) return;
  out.push(p);
}

async function buildHelixPrompts(): Promise<SlashPrompt[]> {
  const out: SlashPrompt[] = [];
  const [{ marketPlatform }, productReads, { helixThermalCompareForLargo }] = await Promise.all([
    import("@/lib/platform"),
    import("@/lib/largo/product-reads"),
    import("@/lib/largo/helix-thermal-compare"),
  ]);

  const [briefPack, analytics, compare, derived] = await Promise.all([
    productReads.flowBriefForLargo(),
    productReads.helixTapeAnalyticsForLargo(null, 200),
    helixThermalCompareForLargo("SPX").catch(() => null),
    productReads.helixDerivedForLargo(null).catch(() => null),
  ]);

  // `call_pct` is `number | null` — null means the tape carried no measurable call/put premium
  // (empty, or every print typeless). This is an `as` cast, so tsc cannot catch drift from the
  // producer: declaring `number` here while helix-tape-analytics returns `number | null` would
  // leave the next reader trusting a type that is false.
  const leaders = (analytics as { net_premium_leaders?: Array<{ ticker: string; net: number; total: number; call_pct: number | null }> })
    .net_premium_leaders ?? [];
  const top = leaders[0];
  const second = leaders[1];

  if (top?.ticker) {
    pushUnique(out, {
      id: "helix-leader",
      label: `${top.ticker} tape leader`,
      // Drop the skew clause entirely when it was not measured — `${null}% calls` renders the
      // literal string "null% calls" on a member-facing chip.
      live: `${top.net >= 0 ? "+" : ""}${fmtPremium(Math.abs(top.net))} net${
        skewChipText(top.call_pct) ? ` · ${skewChipText(top.call_pct)}` : ""
      }`,
      hint: "Biggest net-premium name on the tape right now",
      question: `Summarize HELIX flow on ${top.ticker} — biggest prints, net premium, and anything anomalous.`,
      rank: 10,
    });
  }

  if (second?.ticker) {
    pushUnique(out, {
      id: "helix-second",
      label: `${second.ticker} flow read`,
      live: `${fmtPremium(second.total)} total premium`,
      question: `What's HELIX showing on ${second.ticker} — prints, skew, and conviction?`,
      rank: 20,
    });
  }

  const session = (analytics as { session?: { call_pct?: number | null; alert_count?: number } }).session;
  if (session && (session.alert_count ?? 0) > 0) {
    pushUnique(out, {
      id: "helix-session",
      label: "Session flow skew",
      // `?? 50` was DEAD CODE while call_pct could not be null, and would have become live the
      // moment it could — putting the exact fabricated "50% calls" this lane just removed from
      // the tool payload back in front of a member, on a chip. The guard above is
      // `alert_count > 0`, so it fires precisely on the all-typeless tape: prints exist, none of
      // them carry a side, and the skew is genuinely unmeasured. Say that instead of inventing it.
      live: sessionSkewChip(session.call_pct, session.alert_count ?? 0),
      question: "Summarize today's HELIX tape — call vs put skew, whale prints, and what's leading.",
      rank: 15,
    });
  }

  const brief = (briefPack as { brief?: string | null }).brief;
  if (brief) {
    pushUnique(out, {
      id: "helix-brief",
      label: "Flow brief",
      live: brief.length > 72 ? `${brief.slice(0, 69)}…` : brief,
      question: "Give me the HELIX flow brief — what's anchoring the tape and what's the bias?",
      rank: 12,
    });
  }

  if (compare?.conflict) {
    pushUnique(out, {
      id: "helix-conflict",
      label: "Flow vs gamma conflict",
      live: compare.conflict_note ?? `${compare.helix.bias} vs ${compare.thermal.bias}`,
      question: "Compare HELIX flow vs Thermal GEX on SPX — where do they disagree?",
      rank: 8,
    });
  }

  // `pct` is `number | null` — null when the tape carried no premium to take a share of. This is
  // an `as` cast, so tsc cannot catch drift from the producer; declaring `number` here would leave
  // the next reader trusting a type that is false (the same trap that put "50% calls" on a chip).
  const routes = (analytics as { route_breakdown?: Array<{ route: string; pct: number | null }> }).route_breakdown ?? [];
  const topRoute = routes[0];
  // Explicit null check rather than leaning on `null >= 25` being false: the fail-safe is correct
  // today by accident of coercion, and the next edit should not have to rediscover that.
  // OTHER is not a route — it is the bucket everything unclassifiable falls into, and it holds
  // ~99% of the live tape because `alert_rule` is absent on most prints. "OTHER leading :: 100%
  // of tape premium" was shipping on this chip: absence dressed as a finding. A chip that always
  // says the same thing carries no information, so suppress it rather than render it.
  if (topRoute && topRoute.route !== "OTHER" && topRoute.pct != null && topRoute.pct >= 25) {
    pushUnique(out, {
      id: "helix-route",
      label: `${topRoute.route} leading`,
      live: `${topRoute.pct}% of tape premium`,
      question: `Break down HELIX flow by route — why is ${topRoute.route} dominating and what does it imply?`,
      rank: 25,
    });
  }

  const velocity = (derived as { velocity_spikes?: Array<{ ticker?: string }> } | null)?.velocity_spikes ?? [];
  const spike = velocity[0];
  if (spike?.ticker) {
    pushUnique(out, {
      id: "helix-velocity",
      label: `${spike.ticker} velocity spike`,
      question: `HELIX velocity radar flagged ${spike.ticker} — explain the spike and follow-through risk.`,
      rank: 18,
    });
  }

  pushUnique(out, {
    id: "helix-spx",
    label: "SPX flow",
    question: "Summarize HELIX flow on SPX — biggest prints, tide, and anything anomalous.",
    rank: 30,
  });

  pushUnique(out, {
    id: "helix-open",
    label: "Open HELIX desk",
    question: "What should I filter for on HELIX right now to see the best opportunities?",
    rank: 90,
  });

  return sortPrompts(out);
}

async function buildThermalPrompts(): Promise<SlashPrompt[]> {
  const out: SlashPrompt[] = [];
  const { getGexPositioning } = await import("@/lib/providers/gex-positioning");
  const { helixThermalCompareForLargo } = await import("@/lib/largo/helix-thermal-compare");

  const [spx, compare] = await Promise.all([
    getGexPositioning("SPX").catch(() => null),
    helixThermalCompareForLargo("SPX").catch(() => null),
  ]);

  if (spx) {
    const flip = spx.flip;
    const regime = spx.gamma_regime_read ?? spx.gamma_posture;
    pushUnique(out, {
      id: "thermal-spx",
      label: "SPX gamma map",
      live: [
        spx.spot != null ? `spot ${spx.spot.toFixed(0)}` : null,
        flip != null ? `flip ${flip}` : null,
        regime ? String(regime) : null,
      ]
        .filter(Boolean)
        .join(" · "),
      question: "What's Thermal showing for SPX — flip, walls, gamma regime, and nearest magnets?",
      rank: 10,
    });
  }

  if (compare?.conflict) {
    pushUnique(out, {
      id: "thermal-conflict",
      label: "Gamma vs flow conflict",
      live: compare.conflict_note ?? `${compare.thermal.bias} gamma vs ${compare.helix.bias} flow`,
      question: "Compare Thermal GEX vs HELIX flow on SPX — where do they disagree?",
      rank: 8,
    });
  }

  const { THERMAL_COMPARE_TICKERS } = await import("@/features/thermal/lib/thermal-desk-state");
  pushUnique(out, {
    id: "thermal-compare",
    label: "Mag7 compare grid",
    live: THERMAL_COMPARE_TICKERS.slice(0, 3).join(" · "),
    question: "Compare Thermal gamma on the Mag7 grid — who has the strongest dealer positioning today?",
    rank: 20,
  });

  pushUnique(out, {
    id: "thermal-nvda",
    label: "NVDA positioning",
    question: "What's Thermal showing for NVDA — flip, walls, and gamma regime?",
    rank: 25,
  });

  return sortPrompts(out);
}

async function buildSpxSlayerPrompts(): Promise<SlashPrompt[]> {
  const out: SlashPrompt[] = [];
  const { marketPlatform } = await import("@/lib/platform");
  const { helixThermalCompareForLargo } = await import("@/lib/largo/helix-thermal-compare");

  const [play, compare] = await Promise.all([
    marketPlatform.spx.getSpxPlayState().catch(() => null),
    helixThermalCompareForLargo("SPX").catch(() => null),
  ]);

  const phase = (play as { phase?: string; action?: string; grade?: string } | null)?.phase;
  const action = (play as { action?: string } | null)?.action;
  if (phase || action) {
    pushUnique(out, {
      id: "spx-engine",
      label: "SPX play engine",
      live: [phase, action, (play as { grade?: string })?.grade].filter(Boolean).join(" · "),
      question: "What's the SPX Slayer play engine showing — phase, gates, confluence, and current action?",
      rank: 10,
    });
  }

  if (compare?.thermal) {
    pushUnique(out, {
      id: "spx-structure",
      label: "SPX structure",
      live: [
        compare.thermal.spot != null ? `spot ${compare.thermal.spot.toFixed(0)}` : null,
        compare.thermal.flip != null ? `flip ${compare.thermal.flip}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      question: "What's the SPX setup right now — flip, walls, and dealer positioning?",
      rank: 8,
    });
  }

  pushUnique(out, {
    id: "spx-gex",
    label: "SPX GEX matrix",
    question: "Walk me through the SPX 0DTE GEX matrix — king strike, flip line, and VEX if it matters.",
    rank: 20,
  });

  pushUnique(out, {
    id: "spx-flow-gex",
    label: "Flow vs GEX",
    question: "Compare HELIX flow vs Thermal GEX on SPX — where do they disagree?",
    rank: 15,
  });

  return sortPrompts(out);
}

async function buildNighthawkPrompts(): Promise<SlashPrompt[]> {
  const out: SlashPrompt[] = [];
  const zerodte = await import("@/lib/platform/zerodte-service").then((m) => m.zeroDtePlaysForLargo()).catch(() => null);
  const plays = (zerodte as { plays?: Array<{ ticker?: string; status?: string; pnl_pct?: number }> } | null)?.plays ?? [];
  const open = plays.filter((p) => !/closed|graded/i.test(String(p.status ?? "")));

  pushUnique(out, {
    id: "nh-board",
    label: "0DTE board P&L",
    live: open.length ? `${open.length} open plays` : "Board snapshot",
    question: "What's the 0DTE board P&L — open plays, marks, and any stopped positions?",
    rank: 10,
  });

  const best = [...open].sort((a, b) => Number(b.pnl_pct ?? 0) - Number(a.pnl_pct ?? 0))[0];
  if (best?.ticker) {
    pushUnique(out, {
      id: "nh-best",
      label: `${best.ticker} open play`,
      live: best.pnl_pct != null ? `${best.pnl_pct >= 0 ? "+" : ""}${best.pnl_pct.toFixed(0)}%` : undefined,
      question: `How is the open ${best.ticker} 0DTE play doing — mark, P&L, and exit plan?`,
      rank: 15,
    });
  }

  pushUnique(out, {
    id: "nh-discovery",
    label: "What's committing",
    question: "What's Night Hawk discovering and committing right now — any new 0DTE plays?",
    rank: 20,
  });

  return sortPrompts(out);
}

async function buildVectorPrompts(): Promise<SlashPrompt[]> {
  const out: SlashPrompt[] = [];
  const { fetchVectorFullState } = await import("@/lib/bie/vector-full-state");
  const state = await fetchVectorFullState("SPX").catch(() => null);

  if (state?.spot != null) {
    pushUnique(out, {
      id: "vector-spx",
      label: "SPX Vector read",
      live: [
        `spot ${state.spot.toFixed(0)}`,
        state.regime?.posture ?? null,
        state.gammaFlip != null ? `flip ${state.gammaFlip}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      question: "What's Vector showing for SPX — structure, walls, beads, and bias?",
      rank: 10,
    });
  }

  pushUnique(out, {
    id: "vector-nvda",
    label: "NVDA Vector",
    question: "What's Vector showing for NVDA — structure, walls, and swing bias?",
    rank: 20,
  });

  return sortPrompts(out);
}

async function buildMeridianPrompts(): Promise<SlashPrompt[]> {
  const out: SlashPrompt[] = [];
  pushUnique(out, {
    id: "meridian-today",
    label: "Today's catalysts",
    question: "What's on the Meridian catalyst calendar today — earnings, macro, and top events?",
    rank: 10,
  });
  pushUnique(out, {
    id: "meridian-earnings",
    label: "Next earnings",
    question: "What are the highest-impact earnings on Meridian this week — positioning and expected move?",
    rank: 15,
  });
  pushUnique(out, {
    id: "meridian-macro",
    label: "Macro desk",
    question: "Summarize Meridian macro events today — CPI, FOMC, NFP, or anything market-moving?",
    rank: 20,
  });
  return sortPrompts(out);
}

async function buildLargoPrompts(): Promise<SlashPrompt[]> {
  return sortPrompts([
    {
      id: "largo-desk",
      label: "Desk pulse",
      question: "What should I look at on the desk right now?",
      rank: 10,
    },
    {
      id: "largo-conflict",
      label: "Any conflicts",
      question: "Are HELIX and Thermal disagreeing anywhere — and what should I trust?",
      rank: 15,
    },
    {
      id: "largo-morning",
      label: "Session brief",
      question: "Give me a quick session brief — SPX structure, flow, and open plays.",
      rank: 20,
    },
  ]);
}

async function buildTrackRecordPrompts(): Promise<SlashPrompt[]> {
  return sortPrompts([
    {
      id: "tr-summary",
      label: "Win rate",
      question: "Summarize the public track record — win rate, recent graded plays, and setup stats.",
      rank: 10,
    },
    {
      id: "tr-recent",
      label: "Recent outcomes",
      question: "How have recent 0DTE and SPX plays graded — wins, losses, and patterns?",
      rank: 15,
    },
  ]);
}

/** Map prompt commands to their fixed question as a single chip. */
function promptCommandAsSlashPrompt(cmd: LargoSlashCommand): SlashPrompt[] {
  if (cmd.kind !== "prompt" || !cmd.question) return [];
  return [
    {
      id: cmd.id,
      label: cmd.label,
      hint: cmd.description,
      question: cmd.question,
      rank: 10,
    },
  ];
}

export async function buildSlashPromptsForDesk(
  desk: string,
  cmd?: LargoSlashCommand | null
): Promise<SlashPromptsPayload> {
  const command = cmd?.command ?? desk;
  const label = cmd?.label ?? desk;
  const href = cmd?.href ?? null;

  if (cmd?.kind === "prompt") {
    return {
      desk,
      label,
      command,
      as_of: new Date().toISOString(),
      href: null,
      prompts: promptCommandAsSlashPrompt(cmd),
      modules: [],
    };
  }

  const defaultTicker = deskScopeConfig(desk)?.defaultTicker ?? "SPX";
  const modules = submoduleItemsForDesk(desk, defaultTicker);

  let prompts: SlashPrompt[] = [];
  switch (desk) {
    case "helix":
      prompts = await buildHelixPrompts();
      break;
    case "thermal":
      prompts = await buildThermalPrompts();
      break;
    case "spx-slayer":
      prompts = await buildSpxSlayerPrompts();
      break;
    case "nighthawk":
      prompts = await buildNighthawkPrompts();
      break;
    case "vector":
      prompts = await buildVectorPrompts();
      break;
    case "meridian":
      prompts = await buildMeridianPrompts();
      break;
    case "largo":
      prompts = await buildLargoPrompts();
      break;
    case "track-record":
      prompts = await buildTrackRecordPrompts();
      break;
    default:
      prompts = [
        {
          id: "default",
          label: `Ask about ${label}`,
          question: `What matters on ${label} right now?`,
          rank: 10,
        },
      ];
  }

  return {
    desk,
    label,
    command,
    as_of: new Date().toISOString(),
    href,
    prompts,
    modules,
  };
}

/** Default question when member sends bare `/helix` without picking a chip. */
export function slashDefaultQuestion(cmd: LargoSlashCommand, prompts: SlashPrompt[]): string {
  if (cmd.kind === "prompt" && cmd.question) return cmd.question;
  const first = prompts[0];
  if (first) return first.question;
  return `What should I know about ${cmd.label} right now?`;
}
