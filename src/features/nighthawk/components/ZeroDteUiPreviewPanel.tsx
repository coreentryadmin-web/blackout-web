"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { Badge } from "@/components/ui";
import { BriefingSection } from "@/features/nighthawk/components/briefing/BriefingSection";
import { BriefingScoreBar } from "@/features/nighthawk/components/briefing/BriefingScoreBar";

type PreviewCard = {
  id: string;
  status: "OPEN" | "TRIM" | "HOLD";
  contract: string;
  ticker: string;
  dir: "long" | "short";
  entry: string;
  mark: string;
  pnl: string;
  pnlUp: boolean;
  score: number;
  tier: string;
  conviction: string;
  note: string;
  action: "HOLD" | "TRIM" | "EXIT";
};

const CARDS: PreviewCard[] = [
  {
    id: "nvda",
    status: "OPEN",
    contract: "NVDA 880C",
    ticker: "NVDA",
    dir: "long",
    entry: "$4.20",
    mark: "$5.85",
    pnl: "+39.3%",
    pnlUp: true,
    score: 91,
    tier: "A",
    conviction: "HIGH",
    note: "Flow still one-sided · trim above +50%",
    action: "HOLD",
  },
  {
    id: "meta",
    status: "TRIM",
    contract: "META 520P",
    ticker: "META",
    dir: "short",
    entry: "$3.85",
    mark: "$7.70",
    pnl: "+100%",
    pnlUp: true,
    score: 84,
    tier: "B",
    conviction: "MED",
    note: "Take half off · runner to target",
    action: "TRIM",
  },
];

const ACTION_TONE = { HOLD: "bull", TRIM: "sky", EXIT: "bear" } as const;

function FactorChips() {
  const chips: Array<[string, number]> = [
    ["Flow", 28],
    ["Tech", 12],
    ["Pos", 8],
    ["News", 4],
    ["Smart$", 6],
  ];
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map(([label, v]) => (
        <span
          key={label}
          className="rounded-md border border-bull/25 bg-bull/[0.07] px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-bull"
        >
          {label} +{v}
        </span>
      ))}
    </div>
  );
}

function ExpandedDetail({ card }: { card: PreviewCard }) {
  return (
    <div className="nh-v2-briefing-drawer space-y-3 border-t border-white/[0.06] px-4 py-3">
      <BriefingSection title="Cortex verdict" accent="green">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="bull" size="sm">
            CLEAN
          </Badge>
          <span className="text-[12px] text-sky-200/85">
            Tape aligns with {card.dir} bias · no veto signals · hold through VWAP
          </span>
        </div>
        <ul className="mt-2 space-y-1">
          {[
            { tag: "FLOW", detail: "Call sweeps 3:1 at the ask on 880C", weight: "+32", tone: "bull" as const },
            { tag: "TAPE", detail: "Spot held above opening VWAP", weight: "+18", tone: "bull" as const },
            { tag: "GEX", detail: "Dealers short gamma above 875", weight: "+12", tone: "bull" as const },
          ].map((r) => (
            <li key={r.tag} className="flex items-start gap-2 rounded-md px-1.5 py-1">
              <span className="mt-px shrink-0 font-mono text-[10px] text-bull/80">{r.tag}</span>
              <span className="min-w-0 flex-1 text-[11px] leading-snug text-sky-200/85">{r.detail}</span>
              <span className="t-num shrink-0 text-[11px] font-bold text-bull">{r.weight}</span>
            </li>
          ))}
        </ul>
      </BriefingSection>

      <BriefingSection title="Tier factors" accent="gold">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge tone="bull" size="sm">
            Tier {card.tier}
          </Badge>
          <span className="font-mono text-[10px] uppercase tracking-widest text-gold/80">
            {card.conviction} conviction
          </span>
        </div>
        <BriefingScoreBar label="Composite score" value={card.score} tone="green" />
        <ul className="mt-2 space-y-1 text-[11px] text-sky-200/80">
          <li>✓ Flow dominance above 70% one-sided</li>
          <li>✓ Strike liquidity · spread under 8% of mark</li>
          <li>✓ Session heat green · governor headroom</li>
        </ul>
      </BriefingSection>

      <BriefingSection title="Why this play" accent="green">
        <p className="nh-v2-briefing-prose t-num">
          $12.4M gross · 78% call-side · 42 prints · 61% sweeps · $3.1M last 30m · 3d flow streak
        </p>
        <div className="mt-2">
          <FactorChips />
        </div>
        <div className="mt-2 space-y-0.5 nh-v2-briefing-prose">
          <p>◆ CPI whisper tomorrow · semis leading</p>
          <p>◆ NVDA GTC headlines crossing tape</p>
        </div>
      </BriefingSection>

      <BriefingSection title="What to watch" accent="sky">
        <p className="t-num text-[11px] text-sky-200/85">
          Entry {card.entry} (flow paid ~{card.entry}) · stop −50% ($2.10) · trim/target +100% ($8.40) · hard
          exit 3:30 ET
        </p>
        <p className="mt-1 t-num text-[11px] text-sky-300/75">
          Stock target $895 · idea wrong below $865 · VWAP $876 · S 872/875 · R 882/885
        </p>
        {card.status === "TRIM" && (
          <p className="mt-1 text-[11px] font-semibold text-cyan-300">
            Premium tagged +100% — take at least half off; manage the rest to the 3:30 ET exit.
          </p>
        )}
      </BriefingSection>

      <div className="flex items-center justify-between border-t border-white/[0.06] pt-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-sky-300/50">
          Flagged 10:14 ET · last print 3:42 ET
        </span>
        <span className="rounded-lg border border-cyan-400/30 bg-cyan-400/[0.08] px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-cyan-300">
          Ask LARGO ↗
        </span>
      </div>
    </div>
  );
}

type ZeroDteUiPreviewPanelProps = {
  /** Dev screenshots: force a card expanded on load. */
  defaultExpandedId?: string | null;
};

/** Mock 0DTE column with click-to-expand briefing drawer (mirrors ZeroDteBoard PlayCard). */
export function ZeroDteUiPreviewPanel({ defaultExpandedId = null }: ZeroDteUiPreviewPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(defaultExpandedId);

  return (
    <div className="space-y-3 p-1">
      <div className="flex flex-wrap items-center justify-between gap-2 px-2 pt-1">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-bull/85">
            0DTE Command · Live
          </p>
          <h3 className="font-anton text-xl uppercase tracking-wide text-white">Today&apos;s plays</h3>
        </div>
        <Badge tone="bull" size="sm" dot>
          2 open
        </Badge>
      </div>
      {CARDS.map((c) => {
        const open = expandedId === c.id;
        const live = c.status === "OPEN" || c.status === "HOLD" || c.status === "TRIM";
        return (
          <div
            key={c.id}
            className={clsx(
              "nh-v2-zerodte-card rounded-xl border border-white/[0.08] bg-white/[0.02] transition-colors",
              live && "nh-v2-zerodte-card--open",
              open ? "bg-white/[0.03]" : "hover:bg-white/[0.03]"
            )}
          >
            <button
              type="button"
              className="block w-full cursor-pointer px-4 py-3 text-left"
              onClick={() => setExpandedId(open ? null : c.id)}
              aria-expanded={open}
              aria-label={`${open ? "Collapse" : "Expand"} ${c.contract} briefing`}
            >
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                {live && <span className="nh-v2-live-dot shrink-0" aria-hidden />}
                <Badge tone="bull" size="sm">
                  {c.status}
                </Badge>
                <span className="t-num text-[15px] font-bold text-white">{c.contract}</span>
                <Badge tone={c.dir === "long" ? "bull" : "bear"} size="sm">
                  {c.dir}
                </Badge>
                <Badge tone="bull" size="sm">
                  Tier {c.tier}
                </Badge>
                {c.status === "TRIM" && (
                  <span className="rounded-md border border-cyan-400/35 bg-cyan-400/[0.08] px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-cyan-300">
                    +100% tagged
                  </span>
                )}
                <span className="ml-auto flex items-center gap-2">
                  <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-sky-300/40">score</span>
                  <span className="t-num text-[12px] font-bold text-sky-200/85">{c.score}</span>
                  <span className={clsx("inline-block text-sky-300/40 transition-transform", open && "rotate-90")}>
                    ›
                  </span>
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="inline-flex items-baseline gap-1.5">
                  <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-sky-300/50">flow fill</span>
                  <span className="t-num text-[13px] font-bold text-sky-200/90">{c.entry}</span>
                </span>
                {live && (
                  <span className="inline-flex items-baseline gap-1.5">
                    <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-sky-300/50">mark · mid</span>
                    <span className="t-num text-[13px] font-bold text-white">{c.mark}</span>
                    <span className="t-num text-[10px] text-sky-300/60">5.80×5.90</span>
                  </span>
                )}
                <span
                  className={clsx(
                    "ml-auto t-num text-[14px] font-bold",
                    c.pnlUp ? "nh-v2-pnl-up" : "nh-v2-pnl-down"
                  )}
                >
                  {c.pnl}
                </span>
              </div>
              <div className="mt-2">
                <div className="flex items-start gap-2">
                  <Badge tone={ACTION_TONE[c.action]} size="sm" className="mt-0.5 shrink-0">
                    {c.action}
                  </Badge>
                  <span className="text-[12px] leading-snug text-sky-200/85">{c.note}</span>
                </div>
                {!open && (
                  <p className="nh-v2-card-cta mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-bull/70">
                    Expand for factors · cortex · plan
                  </p>
                )}
              </div>
            </button>
            {open && <ExpandedDetail card={c} />}
          </div>
        );
      })}
    </div>
  );
}
