"use client";

import useSWR from "swr";
import { clsx } from "clsx";
import { Badge, EmptyState, FreshnessChip, Panel, Skeleton } from "@/components/ui";
import type { EnrichedZeroDteSetup, SessionHeat } from "@/lib/zerodte/board";

// ── Response shape (structural mirror of /api/market/zerodte/board) ──────────────

type EngineOrder = { kind: "spx_play" | "lotto" | "power_hour"; state: string; rank: number };

type PlayLane = {
  phase: "SCANNING" | "WATCHING" | "OPEN";
  headline?: string;
  grade?: string;
  confidence?: number;
  levels?: { entry: number | null; stop: number | null; target: number | null };
  open_play?: {
    direction: string;
    entry_price: number;
    stop: number | null;
    target: number | null;
    grade: string;
    option_label?: string | null;
  } | null;
  watch?: { active: boolean; reason: string } | null;
} | null;

type LottoLane = {
  phase: string;
  status_label?: string;
  direction?: string | null;
  contract_label?: string | null;
  entry_zone?: number | null;
  target_price?: number | null;
  headline?: string;
  status_message?: string;
} | null;

type PowerHourLane = {
  phase: string;
  direction?: string | null;
  contract_label?: string | null;
  entry_price?: number | null;
  target_price?: number | null;
  stop_price?: number | null;
  headline?: string;
  status_message?: string;
} | null;

type BoardResponse = {
  available: boolean;
  degraded?: boolean;
  as_of?: string;
  session?: { date: string; trading_day: boolean; market_label: string | null; heat: SessionHeat };
  spx?: {
    price: number | null;
    change_pct: number | null;
    vwap: number | null;
    gamma_flip: number | null;
    call_wall: number | null;
    put_wall: number | null;
    max_pain: number | null;
    regime: string | null;
    confluence: { score: number | null; grade: string | null; bias: string | null } | null;
    thermal_shift: string | null;
  };
  engines?: { order: EngineOrder[]; play: PlayLane; lotto: LottoLane; power_hour: PowerHourLane };
  setups?: EnrichedZeroDteSetup[];
  news?: Array<{ title: string; published: string | null; tickers: string[]; url: string | null }>;
  earnings?: Array<{
    ticker: string;
    name: string;
    when: "premarket" | "afterhours";
    report_date: string | null;
    expected_move_pct: number | null;
    eps_estimate: number | null;
  }>;
  day_log?: Array<{
    id: number;
    direction: string;
    grade: string;
    entry_price: number;
    exit_price: number | null;
    pnl_pts: number | null;
    outcome: string;
    headline: string;
  }>;
};

const fetcher = (url: string) =>
  fetch(url, { cache: "no-store", credentials: "same-origin" }).then((r) => r.json()) as Promise<BoardResponse>;

// ── formatting helpers ────────────────────────────────────────────────────────────

function fmtMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
    });
  } catch {
    return "";
  }
}

function stateTone(state: string): "bull" | "sky" | "neutral" | "bear" {
  if (state === "ACTIVE") return "bull";
  if (state === "ARMED") return "sky";
  if (state === "DONE") return "bear";
  return "neutral";
}

function largoHref(s: EnrichedZeroDteSetup): string {
  const q =
    `Analyze the ${s.ticker} 0DTE ${s.direction} setup: ${fmtMoney(s.gross_premium)} gross premium, ` +
    `${Math.round(s.side_dominance * 100)}% ${s.direction === "long" ? "call" : "put"}-side, ` +
    `top strike ${s.top_strike} expiring ${s.expiry}. Is it still valid right now?`;
  return `/terminal?q=${encodeURIComponent(q)}`;
}

// ── heat header ───────────────────────────────────────────────────────────────────

function HeatHeader({ data }: { data: BoardResponse }) {
  const heat = data.session?.heat;
  if (!heat) return null;
  const hot = heat.heat_pct >= 70;
  return (
    <Panel accent={hot ? "bull" : "sky"} bodyClassName="px-5 py-4 md:px-6 md:py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Badge tone={hot ? "bull" : heat.heat_pct > 0 ? "sky" : "neutral"} size="md" dot={hot}>
            {heat.label}
          </Badge>
          <span className="text-sm text-sky-200/80">{heat.note}</span>
        </div>
        <FreshnessChip status="live" asOf={data.as_of ? new Date(data.as_of) : null} />
      </div>
      {/* Heat meter — how warmed-up the desk is right now. */}
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]" aria-hidden>
        <div
          className={clsx(
            "h-full rounded-full transition-[width] duration-700",
            hot
              ? "bg-gradient-to-r from-sky-400 via-bull to-bull shadow-[0_0_12px_rgba(0,230,118,0.6)]"
              : "bg-gradient-to-r from-sky-500/60 to-sky-400"
          )}
          style={{ width: `${Math.max(2, Math.min(100, heat.heat_pct))}%` }}
        />
      </div>
      {/* SPX structure strip */}
      {data.spx && (
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[11px] tabular-nums">
          <StructStat label="SPX" value={fmtNum(data.spx.price)} delta={data.spx.change_pct} />
          <StructStat label="VWAP" value={fmtNum(data.spx.vwap)} />
          <StructStat label="Gamma flip" value={fmtNum(data.spx.gamma_flip, 0)} />
          <StructStat label="Call wall" value={fmtNum(data.spx.call_wall, 0)} />
          <StructStat label="Put wall" value={fmtNum(data.spx.put_wall, 0)} />
          <StructStat label="Max pain" value={fmtNum(data.spx.max_pain, 0)} />
          {data.spx.confluence?.grade && (
            <StructStat
              label="Confluence"
              value={`${data.spx.confluence.grade}${data.spx.confluence.bias ? ` · ${data.spx.confluence.bias}` : ""}`}
            />
          )}
        </div>
      )}
      {data.spx?.thermal_shift && (
        <p className="mt-2 text-[11px] text-cyan-300/90">
          <span className="font-mono uppercase tracking-widest text-cyan-400">Thermal</span>{" "}
          {data.spx.thermal_shift}
        </p>
      )}
    </Panel>
  );
}

function StructStat({ label, value, delta }: { label: string; value: string; delta?: number | null }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="uppercase tracking-widest text-sky-300/70">{label}</span>
      <span className="text-white">{value}</span>
      {delta != null && Number.isFinite(delta) && (
        <span className={delta >= 0 ? "text-bull" : "text-bear"}>
          {delta >= 0 ? "+" : ""}
          {delta.toFixed(2)}%
        </span>
      )}
    </span>
  );
}

// ── engine cards ──────────────────────────────────────────────────────────────────

const ENGINE_TITLE: Record<EngineOrder["kind"], string> = {
  spx_play: "SPX Play",
  lotto: "SPX Lotto",
  power_hour: "Power Hour",
};

function EngineCards({ data }: { data: BoardResponse }) {
  const engines = data.engines;
  if (!engines) return null;
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {engines.order.map((card) => (
        <Panel
          key={card.kind}
          accent={card.state === "ACTIVE" ? "bull" : card.state === "ARMED" ? "sky" : "accent"}
          kicker={`#${card.rank}`}
          title={ENGINE_TITLE[card.kind]}
          actions={
            <Badge tone={stateTone(card.state)} dot={card.state === "ACTIVE"}>
              {card.state}
            </Badge>
          }
          bodyClassName="px-5 py-4 text-sm"
        >
          {card.kind === "spx_play" && <PlayCard lane={engines.play} />}
          {card.kind === "lotto" && <LottoCard lane={engines.lotto} />}
          {card.kind === "power_hour" && <PowerHourCard lane={engines.power_hour} />}
        </Panel>
      ))}
    </div>
  );
}

function LevelRow({ entries }: { entries: Array<[string, string]> }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] tabular-nums">
      {entries.map(([k, v]) => (
        <span key={k} className="inline-flex items-baseline gap-1">
          <span className="uppercase tracking-widest text-sky-300/70">{k}</span>
          <span className="text-white">{v}</span>
        </span>
      ))}
    </div>
  );
}

function PlayCard({ lane }: { lane: PlayLane }) {
  if (!lane) return <p className="text-sky-300/70">Engine offline.</p>;
  if (lane.open_play) {
    const p = lane.open_play;
    return (
      <div>
        <p className="text-white">
          <span className={p.direction === "long" ? "text-bull" : "text-bear"}>
            {p.direction.toUpperCase()}
          </span>{" "}
          open · grade {p.grade}
          {p.option_label ? ` · ${p.option_label}` : ""}
        </p>
        <LevelRow
          entries={[
            ["Entry", fmtNum(p.entry_price)],
            ["Stop", fmtNum(p.stop)],
            ["Target", fmtNum(p.target)],
          ]}
        />
      </div>
    );
  }
  return (
    <div>
      <p className="text-sky-200/85 line-clamp-2">{lane.headline || "Scanning for the next A-setup."}</p>
      {lane.watch?.active && <p className="mt-1 text-[11px] text-sky-300/70">{lane.watch.reason}</p>}
      {lane.levels && (lane.levels.entry ?? lane.levels.target) != null && (
        <LevelRow
          entries={[
            ["Entry", fmtNum(lane.levels.entry)],
            ["Stop", fmtNum(lane.levels.stop)],
            ["Target", fmtNum(lane.levels.target)],
          ]}
        />
      )}
    </div>
  );
}

function LottoCard({ lane }: { lane: LottoLane }) {
  if (!lane) return <p className="text-sky-300/70">Engine offline.</p>;
  return (
    <div>
      <p className="text-sky-200/85 line-clamp-2">{lane.headline || lane.status_message || lane.status_label}</p>
      {lane.contract_label && (
        <LevelRow
          entries={[
            ["Contract", lane.contract_label],
            ["Entry zone", fmtNum(lane.entry_zone)],
            ["Target", fmtNum(lane.target_price)],
          ]}
        />
      )}
    </div>
  );
}

function PowerHourCard({ lane }: { lane: PowerHourLane }) {
  if (!lane) return <p className="text-sky-300/70">Engine offline.</p>;
  return (
    <div>
      <p className="text-sky-200/85 line-clamp-2">{lane.headline || lane.status_message}</p>
      {lane.contract_label && (
        <LevelRow
          entries={[
            ["Contract", lane.contract_label],
            ["Entry", fmtNum(lane.entry_price)],
            ["Stop", fmtNum(lane.stop_price)],
            ["Target", fmtNum(lane.target_price)],
          ]}
        />
      )}
    </div>
  );
}

// ── setups lane ───────────────────────────────────────────────────────────────────

function FactorChips({ f }: { f: NonNullable<EnrichedZeroDteSetup["factor_breakdown"]> }) {
  const chips: Array<[string, number]> = [
    ["Flow", f.flow],
    ["Tech", f.tech],
    ["Pos", f.positioning],
    ["News", f.news],
    ["Smart$", f.smart_money],
  ];
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map(([label, v]) => (
        <span
          key={label}
          className={clsx(
            "rounded-md border px-1.5 py-0.5 font-mono text-[10px] tabular-nums",
            v > 0
              ? "border-bull/25 bg-bull/[0.07] text-bull"
              : v < 0
                ? "border-bear/25 bg-bear/[0.07] text-bear"
                : "border-white/10 text-sky-300/60"
          )}
        >
          {label} {v > 0 ? `+${v}` : v}
        </span>
      ))}
    </div>
  );
}

function SetupCard({ s }: { s: EnrichedZeroDteSetup }) {
  const long = s.direction === "long";
  return (
    <div className="rounded-xl border border-white/10 bg-[rgba(8,9,14,0.45)] p-4">
      {/* header row */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-base font-bold text-white">{s.ticker}</span>
        <Badge tone={long ? "bull" : "bear"} size="sm">
          {long ? "CALLS" : "PUTS"} {fmtNum(s.top_strike, 2)}
        </Badge>
        <span className="font-mono text-[11px] text-sky-300/80">
          {s.dte === 0 ? "0DTE" : "1DTE"} · exp {s.expiry}
        </span>
        {s.spike && (
          <Badge tone="accent" size="sm" dot>
            Flow spike
          </Badge>
        )}
        {s.halted && (
          <Badge tone="bear" size="sm" dot>
            Halted
          </Badge>
        )}
        {s.earnings && (
          <Badge tone="sky" size="sm">
            Earnings {s.earnings.when === "premarket" ? "pre" : "AH"}
            {s.earnings.expected_move_pct != null ? ` ±${s.earnings.expected_move_pct}%` : ""}
          </Badge>
        )}
        {s.direction_confirmed === false && (
          <Badge tone="bear" size="sm">
            Dossier disagrees
          </Badge>
        )}
        <span className="ml-auto inline-flex items-center gap-2">
          {s.dossier_score != null && (
            <span className="font-mono text-[11px] text-sky-300/80">
              Dossier {s.dossier_score}
              {s.conviction ? ` · ${s.conviction}` : ""}
            </span>
          )}
          <span
            className={clsx(
              "rounded-lg border px-2 py-0.5 font-mono text-sm font-bold tabular-nums",
              s.score >= 70
                ? "border-bull/35 bg-bull/10 text-bull"
                : s.score >= 45
                  ? "border-sky-400/30 bg-sky-400/10 text-sky-300"
                  : "border-white/10 text-sky-300/70"
            )}
          >
            {s.score}
          </span>
        </span>
      </div>

      {/* tape evidence */}
      <p className="mt-2 font-mono text-[11px] tabular-nums text-sky-200/85">
        {fmtMoney(s.gross_premium)} gross · {Math.round(s.side_dominance * 100)}%{" "}
        {long ? "call" : "put"}-side · {s.prints} prints · {Math.round(s.sweep_pct * 100)}% sweeps
        {s.recent_premium_30m > 0 ? ` · ${fmtMoney(s.recent_premium_30m)} last 30m` : ""}
        {s.streak_days != null && s.streak_days > 1 ? ` · ${s.streak_days}d streak` : ""}
        {s.dark_pool_bias ? ` · DP ${s.dark_pool_bias}` : ""}
      </p>

      {/* chart read */}
      {(s.trend || s.fib_note || s.key_supports.length > 0 || s.key_resistances.length > 0) && (
        <p className="mt-1.5 font-mono text-[11px] tabular-nums text-sky-300/75">
          {s.trend ? `${s.trend}` : ""}
          {s.rsi14 != null ? ` · RSI ${Math.round(s.rsi14)}` : ""}
          {s.rel_volume != null ? ` · ${s.rel_volume.toFixed(1)}x vol` : ""}
          {s.vwap != null ? ` · VWAP ${fmtNum(s.vwap)}` : ""}
          {s.key_supports.length > 0 ? ` · S ${s.key_supports.map((l) => fmtNum(l)).join("/")}` : ""}
          {s.key_resistances.length > 0 ? ` · R ${s.key_resistances.map((l) => fmtNum(l)).join("/")}` : ""}
        </p>
      )}
      {s.fib_note && (
        <p className="mt-1 text-[11px]">
          <span
            className={clsx(
              "rounded-md border px-1.5 py-0.5 font-mono",
              s.fib_note.golden
                ? "border-gold/40 bg-gold/10 text-gold"
                : "border-sky-400/25 bg-sky-400/[0.07] text-sky-300"
            )}
          >
            {s.fib_note.golden ? "★ " : ""}At {s.fib_note.label} fib ({fmtNum(s.fib_note.price)})
          </span>
        </p>
      )}

      {/* factor breakdown + catalysts */}
      {s.factor_breakdown && (
        <div className="mt-2">
          <FactorChips f={s.factor_breakdown} />
        </div>
      )}
      {(s.catalyst_flags.length > 0 || s.analyst_note || s.news_hot) && (
        <div className="mt-2 space-y-0.5 text-[11px] text-sky-200/80">
          {s.catalyst_flags.map((c) => (
            <p key={c}>◆ {c}</p>
          ))}
          {s.analyst_note && <p>◆ {s.analyst_note}</p>}
          {s.news_hot && (
            <p>
              ◆{" "}
              {s.news_hot.url ? (
                <a
                  href={s.news_hot.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-300 underline decoration-cyan-300/40 hover:text-cyan-200"
                >
                  {s.news_hot.title}
                </a>
              ) : (
                s.news_hot.title
              )}{" "}
              <span className="text-sky-300/60">({s.news_hot.minutes_ago}m ago)</span>
            </p>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-widest text-sky-300/50">
          {s.first_seen ? `First print ${fmtTime(s.first_seen)}` : ""}
          {s.last_seen ? ` · last ${fmtTime(s.last_seen)} ET` : ""}
        </span>
        <a
          href={largoHref(s)}
          className="rounded-lg border border-cyan-400/30 bg-cyan-400/[0.08] px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-cyan-300 transition-colors hover:bg-cyan-400/[0.16] hover:text-cyan-200"
        >
          Ask LARGO ↗
        </a>
      </div>
    </div>
  );
}

// ── context lanes ─────────────────────────────────────────────────────────────────

function NewsLane({ items }: { items: NonNullable<BoardResponse["news"]> }) {
  return (
    <Panel accent="sky" kicker="Context" title="Live news" bodyClassName="px-5 py-3">
      {items.length === 0 ? (
        <p className="py-3 text-sm text-sky-300/70">No fresh headlines.</p>
      ) : (
        <ul className="divide-y divide-white/[0.06]">
          {items.map((a, i) => (
            <li key={`${a.title}-${i}`} className="py-2">
              <p className="text-sm leading-snug text-white/90 line-clamp-2">
                {a.url ? (
                  <a href={a.url} target="_blank" rel="noopener noreferrer" className="hover:text-cyan-200">
                    {a.title}
                  </a>
                ) : (
                  a.title
                )}
              </p>
              <p className="mt-0.5 font-mono text-[10px] text-sky-300/60">
                {fmtTime(a.published)} ET{a.tickers.length ? ` · ${a.tickers.join(" · ")}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function EarningsLane({ items }: { items: NonNullable<BoardResponse["earnings"]> }) {
  return (
    <Panel accent="accent" kicker="Context" title="Earnings — today & next session" bodyClassName="px-5 py-3">
      {items.length === 0 ? (
        <p className="py-3 text-sm text-sky-300/70">No reporters in the window.</p>
      ) : (
        <ul className="divide-y divide-white/[0.06]">
          {items.map((e) => (
            <li key={`${e.ticker}-${e.when}`} className="flex items-center gap-3 py-2">
              <span className="font-mono text-sm font-bold text-white">{e.ticker}</span>
              <Badge tone={e.when === "premarket" ? "sky" : "accent"} size="sm">
                {e.when === "premarket" ? "Pre-mkt" : "After hrs"}
              </Badge>
              <span className="truncate text-[11px] text-sky-300/70">{e.name}</span>
              <span className="ml-auto font-mono text-[11px] tabular-nums text-sky-200/85">
                {e.expected_move_pct != null ? `±${e.expected_move_pct}% EM` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function DayLog({ items }: { items: NonNullable<BoardResponse["day_log"]> }) {
  if (items.length === 0) return null;
  return (
    <Panel accent="bull" kicker="Today" title="Graded plays" bodyClassName="px-5 py-3">
      <ul className="divide-y divide-white/[0.06]">
        {items.map((o) => (
          <li key={o.id} className="flex items-center gap-3 py-2">
            <Badge tone={o.outcome === "win" ? "bull" : o.outcome === "loss" ? "bear" : "neutral"} size="sm">
              {o.outcome}
            </Badge>
            <span className="truncate text-sm text-white/90">{o.headline}</span>
            <span className="ml-auto font-mono text-[11px] tabular-nums text-sky-200/85">
              {fmtNum(o.entry_price)} → {fmtNum(o.exit_price)}
              {o.pnl_pts != null && (
                <span className={o.pnl_pts >= 0 ? "text-bull" : "text-bear"}>
                  {" "}
                  ({o.pnl_pts >= 0 ? "+" : ""}
                  {o.pnl_pts.toFixed(1)} pts)
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ── board ─────────────────────────────────────────────────────────────────────────

/**
 * 0DTE Command — the intraday "what should I be looking at right now" board.
 * Composes the graded SPX engines, live SPX structure, and dossier-enriched
 * single-name 0DTE setups from the HELIX tape. Polls at member cadence; the
 * server route is read-only over every engine, so polling never mutates state.
 */
export function ZeroDteBoard() {
  const { data, error } = useSWR<BoardResponse>("/api/market/zerodte/board", fetcher, {
    refreshInterval: 15_000,
    revalidateOnFocus: true,
  });

  if (error || data?.available === false) {
    return (
      <EmptyState
        icon="◆"
        title="Board temporarily degraded"
        description="Data lanes are unavailable right now — the board recovers automatically."
      />
    );
  }
  if (!data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 w-full rounded-2xl" />
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
        </div>
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  const setups = data.setups ?? [];

  return (
    <div className="space-y-4">
      <HeatHeader data={data} />
      <EngineCards data={data} />

      <Panel
        accent="bull"
        kicker="HELIX tape · Night Hawk dossiers"
        title="0DTE setups — best of the tape"
        actions={
          <Badge tone="neutral" size="sm">
            {setups.length} live
          </Badge>
        }
        bodyClassName="px-5 py-4"
      >
        {setups.length === 0 ? (
          <p className="py-4 text-sm text-sky-300/70">
            No single-name 0DTE concentration clears the evidence gates yet — setups print here as the
            tape builds.
          </p>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {setups.map((s) => (
              <SetupCard key={s.ticker} s={s} />
            ))}
          </div>
        )}
        <p className="mt-3 text-[10px] leading-relaxed text-sky-300/50">
          Setups are directional evidence reads (tape + dossier), not managed plays — entries, stops and
          grading exist only on the engine cards above, which grade themselves into the track record.
        </p>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <NewsLane items={data.news ?? []} />
        <EarningsLane items={data.earnings ?? []} />
      </div>

      <DayLog items={data.day_log ?? []} />
    </div>
  );
}
