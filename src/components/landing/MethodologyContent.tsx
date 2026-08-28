import type { ReactNode } from "react";
import Link from "next/link";
import { MarkdownBody } from "@/components/learn/MarkdownBody";
import { TrackRecordEmbed } from "@/components/embeds/TrackRecordEmbed";
import { TRACK_RECORD_MIN_SAMPLE } from "@/components/track-record/format";
import type { PublicTrackRecord } from "@/lib/track-record-public";
import type { TrackRecordPagePayload } from "@/lib/track-record-page";
import { TRACK_RECORD_METHODOLOGY } from "@/lib/track-record-page";
import { ZERODTE_RECORD_METHODOLOGY } from "@/lib/zerodte/record";

const INTRO = `Most trading services show you the wins and quietly forget the rest. BlackOut does the opposite: **every setup is logged, graded, and timestamped** — winners and losers alike. This page is the receipts desk: how we grade outcomes, what each product measures, and the live aggregate numbers you can verify before you subscribe.

The headline rule: **three products, three grading systems, never blended.** SPX Slayer, Night Hawk, and 0DTE Command each publish their own win/loss ledger with an explicit methodology. Mixing them into one "overall win rate" would be dishonest — we don't do it anywhere on the site.`;

const SPX_DETAIL = `## SPX Slayer (0DTE desk)

SPX Slayer grades **closed SPX plays from the play ledger** — every opened signal, no cherry-picking. Outcomes are measured in **index points** against the published entry, stop, and target structure. Cold-buy and watch→promote paths are tracked separately so you can see how each entry style performs.

Scratch/breakeven rows count in the denominator but not as wins or losses. Adaptive gating may tighten or loosen the desk's selectivity based on recent ledger performance — when active, the summary line on the card below reflects it.`;

const NH_DETAIL = `## Night Hawk (swing editions)

Night Hawk grades **published edition plays** against their printed target and stop levels. Returns reflect **next-session underlying stock movement** from the entry-range midpoint — not option-premium P&L. Actual option results depend on strike, expiry, and implied volatility at entry.

Plays that never traded back into the entry band (unfilled), were invalidated pre-open (pulled), or were graded under a superseded rule set are **excluded from the headline record** — they stay on the row for calibration but do not pad the win rate. Ratio stats (win rate, profit factor) only render once the decided sample reaches ${TRACK_RECORD_MIN_SAMPLE} plays.`;

const ZD_DETAIL = `## 0DTE Command (scanner ledger)

0DTE Command grades **every committed scanner setup** on the option's own premium. The headline number is the **as-managed** exit — the ratchet, thesis-break, flat-timeout, or plan stop/target the member was live-guided to take. A fixed mechanical plan grade (−50% / +100% / 15:50 ET) rides beside it as a labeled comparison, never blended in.

These are option-premium returns — not SPX point results and not Night Hawk stock-move percentages.`;

const DISCLAIM = `> *BlackOut provides educational tools and market analysis only and does not provide investment advice. Options and equities trading involve substantial risk and are not suitable for every investor. Past performance of any setup or grade does not guarantee future results.*`;

function fmtWinRate(pct: number | null | undefined): string {
  if (pct == null) return "—";
  return `${pct}%`;
}

function LaneStat({
  label,
  value,
  tone = "white",
}: {
  label: string;
  value: ReactNode;
  tone?: "white" | "bull" | "bear" | "sky";
}) {
  const toneClass =
    tone === "bull"
      ? "text-cyan-400"
      : tone === "bear"
        ? "text-red-400"
        : tone === "sky"
          ? "text-sky-300"
          : "text-white";
  return (
    <div className="rounded-lg border border-white/10 bg-black/40 px-4 py-3 text-center">
      <p className={`font-mono text-xl font-bold tabular-nums ${toneClass}`}>{value}</p>
      <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-sky-300">{label}</p>
    </div>
  );
}

function NightHawkStats({ nh }: { nh: TrackRecordPagePayload["nightHawk"] }) {
  const decided = nh.decided ?? nh.total;
  const early = decided < TRACK_RECORD_MIN_SAMPLE;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <LaneStat label="Scoreable" value={nh.total} />
      <LaneStat label="Wins" value={nh.wins} tone="bull" />
      <LaneStat label="Losses" value={nh.losses} tone="bear" />
      <LaneStat
        label="Win rate"
        value={early ? "Collecting" : fmtWinRate(nh.winRatePct)}
        tone={early ? "sky" : "white"}
      />
    </div>
  );
}

function ZeroDteStats({ zd }: { zd: NonNullable<TrackRecordPagePayload["zerodte"]> }) {
  const early = zd.graded < TRACK_RECORD_MIN_SAMPLE;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <LaneStat label="Graded" value={zd.graded} />
      <LaneStat label="Wins" value={zd.wins} tone="bull" />
      <LaneStat label="Losses" value={zd.losses} tone="bear" />
      <LaneStat
        label="Win rate"
        value={early ? "Collecting" : fmtWinRate(zd.winRatePct)}
        tone={early ? "sky" : "white"}
      />
    </div>
  );
}

export function MethodologyContent({
  breadcrumbs,
  spxRecord,
  payload,
}: {
  breadcrumbs?: ReactNode;
  spxRecord: PublicTrackRecord;
  payload: TrackRecordPagePayload;
}) {
  const zd = payload.zerodte;

  return (
    <section className="mx-auto max-w-3xl px-4 py-20 sm:px-6 lg:px-8">
      {breadcrumbs}
      <p className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.25em] text-cyan-300">
        Public record
      </p>
      <h1 className="font-syne text-3xl font-bold leading-tight text-white sm:text-4xl lg:text-5xl">
        Grading methodology &amp; live receipts
      </h1>
      <p className="mt-4 max-w-2xl text-base leading-relaxed text-secondary sm:text-lg">
        How BlackOut grades every setup — and the aggregate numbers behind the homepage claims.
      </p>

      <div className="mt-12 space-y-10">
        <MarkdownBody content={INTRO} />

        <div>
          <TrackRecordEmbed record={spxRecord} className="w-full" />
        </div>

        <MarkdownBody content={SPX_DETAIL} />

        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.25em] text-cyan-300">
            Night Hawk · 90-day window
          </p>
          <NightHawkStats nh={payload.nightHawk} />
        </div>

        <MarkdownBody content={NH_DETAIL} />

        {zd ? (
          <>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
              <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.25em] text-cyan-300">
                0DTE Command · {zd.windowDays}-day window
              </p>
              <ZeroDteStats zd={zd} />
            </div>
            <MarkdownBody content={ZD_DETAIL} />
            <p className="font-mono text-xs leading-relaxed text-sky-300">{ZERODTE_RECORD_METHODOLOGY}</p>
          </>
        ) : (
          <p className="font-mono text-sm text-sky-300">
            0DTE Command ledger warming up — aggregate stats populate as plays grade post-close.
          </p>
        )}

        <div className="rounded-lg border border-cyan-400/20 bg-cyan-400/5 px-4 py-3">
          <p className="font-mono text-xs leading-relaxed text-sky-300">{TRACK_RECORD_METHODOLOGY}</p>
        </div>

        <MarkdownBody content={DISCLAIM} />
      </div>

      <div className="mt-12 flex flex-wrap gap-4">
        <Link
          href="/pricing"
          className="inline-flex items-center rounded-lg bg-cyan-400 px-6 py-3 font-mono text-sm font-semibold text-black transition hover:bg-cyan-300"
        >
          See the plans →
        </Link>
        <Link
          href="/why-blackout"
          className="inline-flex items-center rounded-lg border border-white/20 px-6 py-3 font-mono text-sm font-semibold text-white transition hover:border-white/40 hover:bg-white/5"
        >
          Why BlackOut? →
        </Link>
      </div>
    </section>
  );
}
