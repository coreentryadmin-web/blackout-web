"use client";

import useSWR from "swr";
import { clsx } from "clsx";
import { Badge, EmptyState, FreshnessChip, Panel, Skeleton } from "@/components/ui";
import type { EnrichedZeroDteSetup, SessionHeat } from "@/lib/zerodte/board";

// ── Response shape (structural mirror of /api/market/zerodte/board) ──────────────

type EngineStripItem = { kind: "spx_play" | "lotto" | "power_hour"; state: string };

type LedgerRow = {
  ticker: string;
  direction: "long" | "short";
  score_max: number;
  spike: boolean;
  first_flagged_at: string;
  underlying_at_flag: number | null;
  top_strike: number | null;
  conviction: string | null;
  move_pct: number | null;
  direction_hit: boolean | null;
  graded: boolean;
};

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
  engine_strip?: EngineStripItem[];
  setups?: EnrichedZeroDteSetup[];
  ledger?: LedgerRow[];
  nighthawk_covered?: string[];
  news?: Array<{ title: string; published: string | null; tickers: string[]; url: string | null }>;
  earnings?: Array<{
    ticker: string;
    name: string;
    when: "premarket" | "afterhours";
    report_date: string | null;
    expected_move_pct: number | null;
    eps_estimate: number | null;
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
      {/* Heat meter — how warmed-up the hunt is right now. */}
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
      {/* Market context strip (SPX structure + THERMAL) — context, not plays. */}
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

// ── thin engine strip (context only — plays live on their own pages) ─────────────

const ENGINE_LABEL: Record<EngineStripItem["kind"], { name: string; href: string }> = {
  spx_play: { name: "SPX Play", href: "/dashboard" },
  lotto: { name: "SPX Lotto", href: "/dashboard" },
  power_hour: { name: "Power Hour", href: "/dashboard" },
};

function EngineStrip({ items }: { items: EngineStripItem[] }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-white/[0.08] bg-[rgba(8,9,14,0.35)] px-4 py-2.5">
      <span className="font-mono text-[10px] uppercase tracking-widest text-sky-300/50">
        SPX engines (own pages — not duplicated here)
      </span>
      {items.map((e) => (
        <a key={e.kind} href={ENGINE_LABEL[e.kind].href} className="inline-flex items-center gap-1.5 hover:opacity-80">
          <span className="text-[11px] text-sky-200/80">{ENGINE_LABEL[e.kind].name}</span>
          <Badge tone={stateTone(e.state)} size="sm" dot={e.state === "ACTIVE"}>
            {e.state}
          </Badge>
        </a>
      ))}
    </div>
  );
}

// ── setup cards (the hero lane) ───────────────────────────────────────────────────

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

// ── ledger (the always-on scanner's session record) ──────────────────────────────

function LedgerLane({ rows }: { rows: LedgerRow[] }) {
  if (rows.length === 0) return null;
  const graded = rows.filter((r) => r.graded && r.direction_hit != null);
  const hits = graded.filter((r) => r.direction_hit === true).length;
  return (
    <Panel
      accent="accent"
      kicker="Scanner ledger"
      title="Flagged today"
      actions={
        graded.length > 0 ? (
          <Badge tone={hits * 2 >= graded.length ? "bull" : "bear"} size="sm">
            {hits}/{graded.length} hit
          </Badge>
        ) : (
          <Badge tone="neutral" size="sm">
            {rows.length} flagged
          </Badge>
        )
      }
      bodyClassName="px-5 py-3"
    >
      <ul className="divide-y divide-white/[0.06]">
        {rows.map((r) => (
          <li key={r.ticker} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
            <span className="font-mono text-[10px] tabular-nums text-sky-300/60">
              {fmtTime(r.first_flagged_at)} ET
            </span>
            <span className="font-mono text-sm font-bold text-white">{r.ticker}</span>
            <Badge tone={r.direction === "long" ? "bull" : "bear"} size="sm">
              {r.direction === "long" ? "CALLS" : "PUTS"}
              {r.top_strike != null ? ` ${fmtNum(r.top_strike, 2)}` : ""}
            </Badge>
            {r.spike && (
              <Badge tone="accent" size="sm">
                spike
              </Badge>
            )}
            <span className="font-mono text-[11px] tabular-nums text-sky-300/80">
              peak {r.score_max}
              {r.underlying_at_flag != null ? ` · @ ${fmtNum(r.underlying_at_flag)}` : ""}
            </span>
            {r.graded && r.move_pct != null && (
              <span
                className={clsx(
                  "ml-auto font-mono text-[11px] font-bold tabular-nums",
                  r.direction_hit ? "text-bull" : "text-bear"
                )}
              >
                {r.move_pct >= 0 ? "+" : ""}
                {r.move_pct.toFixed(2)}% {r.direction_hit ? "✓" : "✗"}
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[10px] leading-relaxed text-sky-300/50">
        Every row is stamped when the scanner FIRST flagged the name (with the live price at that
        moment) and graded against the session close — the hunt&apos;s record is measured, not asserted.
      </p>
    </Panel>
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

// ── board ─────────────────────────────────────────────────────────────────────────

/**
 * 0DTE Command — the always-on hunt for NEW single-name 0DTE plays. The server-side
 * scanner runs every ~2 min through the session (grid-warm cron) and keeps a graded
 * ledger; this component is the live window onto it. SPX/Night Hawk plays are
 * deliberately NOT reproduced here — engine states appear only as a context strip.
 */
export function ZeroDteBoard() {
  const { data, error } = useSWR<BoardResponse>("/api/market/zerodte/board", fetcher, {
    refreshInterval: (latest) => (latest?.session?.heat?.state === "CLOSED" ? 60_000 : 15_000),
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
        <Skeleton className="h-72 w-full rounded-2xl" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    );
  }

  const setups = data.setups ?? [];
  const covered = data.nighthawk_covered ?? [];

  return (
    <div className="space-y-4">
      <HeatHeader data={data} />

      <Panel
        accent="bull"
        kicker="Always-on scanner · HELIX tape · Night Hawk dossiers"
        title="Fresh 0DTE finds — new plays only"
        actions={
          <Badge tone={setups.length > 0 ? "bull" : "neutral"} size="sm" dot={setups.length > 0}>
            {setups.length} live
          </Badge>
        }
        bodyClassName="px-5 py-4"
      >
        {setups.length === 0 ? (
          <p className="py-4 text-sm text-sky-300/70">
            Nothing clears the evidence gates right now — the scanner keeps hunting every 2 minutes
            and new finds print here the moment the tape concentrates.
          </p>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {setups.map((s) => (
              <SetupCard key={s.ticker} s={s} />
            ))}
          </div>
        )}
        <p className="mt-3 text-[10px] leading-relaxed text-sky-300/50">
          New names only: SPX index plays and anything Night Hawk already published are excluded by
          design{covered.length > 0 ? ` (withheld today: ${covered.join(", ")} — see Night Hawk)` : ""}.
          Finds are directional evidence reads (tape + dossier), not managed plays with entries/stops.
        </p>
      </Panel>

      <LedgerLane rows={data.ledger ?? []} />

      <EngineStrip items={data.engine_strip ?? []} />

      <div className="grid gap-4 lg:grid-cols-2">
        <NewsLane items={data.news ?? []} />
        <EarningsLane items={data.earnings ?? []} />
      </div>
    </div>
  );
}
