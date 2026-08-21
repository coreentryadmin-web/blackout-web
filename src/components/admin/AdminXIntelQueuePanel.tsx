"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import {
  EmptyDeck,
  FilterSelect,
  GlassPanel,
  MetricChip,
} from "@/components/admin/AdminUi";
import { X_INTEL_QUEUE_FIXTURES } from "@/lib/x-intel/queue-fixtures";
import type {
  XIntelAttachment,
  XIntelMark,
  XIntelQueueRow,
  XIntelStatus,
} from "@/lib/x-intel/queue-types";

/**
 * THE REVIEWER'S SURFACE. Built before the generator, on purpose: it is what makes every later
 * stage inspectable, and a pipeline whose output nobody can read is a pipeline nobody can correct.
 *
 * The design rule throughout is that a reviewer must be able to act WITHOUT asking the pipeline a
 * question. Three consequences that are not cosmetic:
 *
 * - A SKIP row renders as a DECISION with its reason and what was inspected, never as an empty
 *   row. "Nothing worth posting this hour" is a result; an empty row reads as a broken cycle.
 * - A missing `confidence` renders as "not calibrated", not as a blank or a zero. Absence is a
 *   finding (rule 7), and a blank invites the reader to supply their own number.
 * - A precedence claim renders both timestamps it rests on, adjacent, with the interval spelled
 *   out — so the reviewer checks the claim instead of trusting it. The store already refuses to
 *   persist a READY row whose ordering is wrong; this is the human-legible second look.
 *
 * There is no publish button and there must never be one. The queue exists because a person
 * stands between a generated package and the live account.
 */

const REFRESH_MS = 120_000;

const STATUS_TONE: Record<XIntelStatus, "bull" | "amber" | "neutral"> = {
  READY: "bull",
  REVIEW: "amber",
  SKIP: "neutral",
};

const SURFACE_LABEL: Record<string, string> = {
  spx_slayer: "SPX Slayer",
  helix: "Helix",
  thermal: "Thermal",
  vector: "Vector",
  nighthawk: "Night Hawk",
  meridian: "Meridian",
  largo: "Largo",
  market: "Market",
};

function surfaceLabel(id: string): string {
  return SURFACE_LABEL[id] ?? id;
}

function minutesBetween(aMs: number, bMs: number): string {
  const mins = Math.round((bMs - aMs) / 60_000);
  if (mins === 0) return "same minute";
  const abs = Math.abs(mins);
  const unit = abs === 1 ? "minute" : "minutes";
  return mins > 0 ? `${abs} ${unit} earlier` : `${abs} ${unit} LATER`;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  const copy = useCallback(() => {
    void navigator.clipboard?.writeText(text).then(() => {
      setDone(true);
      setTimeout(() => setDone(false), 1600);
    });
  }, [text]);
  return (
    <button type="button" onClick={copy} className="admin-action-btn">
      {done ? "Copied" : label}
    </button>
  );
}

function MarkRow({ mark, emphasis }: { mark: XIntelMark; emphasis?: "detection" | "event" }) {
  return (
    <div className="flex items-baseline gap-2 py-0.5">
      <span
        className={clsx(
          "font-mono text-[11px] tabular-nums",
          emphasis === "detection"
            ? "font-bold text-bull"
            : emphasis === "event"
              ? "font-bold text-amber"
              : "text-white/50",
        )}
      >
        {mark.at_et.slice(11)}
      </span>
      <span className="text-[11px] text-white/70">
        {mark.surface ? (
          <span className="font-mono text-[10px] uppercase text-white/40">
            {surfaceLabel(mark.surface)}{" "}
          </span>
        ) : null}
        {mark.what}
      </span>
    </div>
  );
}

function Chronology({ row }: { row: XIntelQueueRow }) {
  const chron = row.chronology;
  if (!chron) return null;

  const { detection, market_event: event, precedence_claimed: claimed } = chron;
  const ordered = [...chron.marks].sort((a, b) => a.at_ms - b.at_ms);

  return (
    <div className="mt-3 rounded border border-white/10 bg-black/20 p-3">
      <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-white/40">
        Chronology
      </p>

      {claimed && detection && event ? (
        <div className="mb-2 rounded border border-bull/30 bg-bull/5 p-2">
          <p className="mb-1 font-mono text-[10px] font-bold uppercase text-bull">
            Precedence claimed — BLACKOUT saw it first
          </p>
          <MarkRow mark={detection} emphasis="detection" />
          <MarkRow mark={event} emphasis="event" />
          <p className="mt-1 font-mono text-[10px] text-white/50">
            Detection was {minutesBetween(detection.at_ms, event.at_ms)} than the move.
          </p>
        </div>
      ) : (
        <p className="mb-2 font-mono text-[10px] uppercase text-white/45">
          No precedence claim — reported after the fact
        </p>
      )}

      {ordered.length > 0 && <div>{ordered.map((m, i) => <MarkRow key={i} mark={m} />)}</div>}
    </div>
  );
}

function AttachmentCard({ a }: { a: XIntelAttachment }) {
  return (
    <div className="rounded border border-white/10 bg-black/20 p-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-cyan">
          {a.slot} · {a.role.replace(/_/g, " ")}
        </span>
        <span className="font-mono text-[10px] uppercase text-white/40">
          {surfaceLabel(a.source_surface)}
        </span>
      </div>
      <p className="text-[11px] text-white/80">{a.caption}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
        <a
          href={a.image_url}
          download
          className="font-mono text-[10px] text-cyan underline decoration-dotted"
        >
          download frame
        </a>
        <a
          href={a.source_url}
          target="_blank"
          rel="noreferrer"
          className="truncate font-mono text-[10px] text-white/35 underline decoration-dotted"
        >
          {a.source_url.replace(/^https:\/\/[^/]+/, "")}
        </a>
        <span className="font-mono text-[10px] text-white/35">{a.captured_at_et}</span>
      </div>
    </div>
  );
}

function PackageCard({ row }: { row: XIntelQueueRow }) {
  const isSkip = row.status === "SKIP";
  const surfaces = new Set(row.attachments.map((a) => a.source_surface));

  return (
    <GlassPanel
      accent={row.status === "READY" ? "bull" : row.status === "REVIEW" ? "amber" : "cyan"}
      kicker={`${row.created_at_et} · ${row.ticker_or_market} · cycle ${row.cycle_key}`}
      title={row.headline}
    >
      <div className="flex flex-wrap gap-1.5">
        <MetricChip label="status" value={row.status} tone={STATUS_TONE[row.status]} />
        {row.format && (
          <MetricChip label="format" value={row.format.replace(/_/g, " ")} tone="violet" />
        )}
        <MetricChip
          label="attachments"
          value={
            isSkip
              ? "—"
              : `${row.attachments.length} · ${surfaces.size} surface${surfaces.size === 1 ? "" : "s"}`
          }
          tone={!isSkip && surfaces.size < 2 ? "bear" : "neutral"}
        />
        {/* Contract C6 — an absent score says so in words. It is never a blank or a zero. */}
        <MetricChip
          label="confidence"
          value={
            row.confidence
              ? `${row.confidence.score.toFixed(2)} · n=${row.confidence.sample_size ?? "—"}`
              : "not calibrated"
          }
          tone={row.confidence ? "cyan" : "neutral"}
        />
        {row.posted_tweet_id && (
          <MetricChip label="posted" value={row.posted_tweet_id} tone="bull" />
        )}
      </div>

      {row.confidence && (
        <p className="mt-1.5 font-mono text-[10px] text-white/40">
          basis: {row.confidence.basis}
        </p>
      )}

      {row.post_copy ? (
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-wider text-white/40">
              Post copy — paste as-is
            </span>
            <CopyButton text={row.post_copy} label="Copy post" />
          </div>
          <pre className="whitespace-pre-wrap rounded border border-white/10 bg-black/30 p-3 font-mono text-[12px] leading-relaxed text-white/90">
            {row.post_copy}
          </pre>
        </div>
      ) : (
        // A SKIP row is a decision, not a hole. It says what it looked at and why it declined.
        <div className="mt-3 rounded border border-white/10 bg-black/30 p-3">
          <p className="font-mono text-[11px] font-bold uppercase tracking-wider text-white/70">
            No high-value post this hour
          </p>
          <p className="mt-1 text-[11px] text-white/60">{row.reason_selected}</p>
        </div>
      )}

      {/* The CTA is a REPLY, copied separately — never pasted into the post body. See cta.ts. */}
      {row.cta && (
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-wider text-white/40">
              CTA reply · {row.cta.variant.replace(/_/g, " ")} — post as a reply, not in the body
            </span>
            <CopyButton text={row.cta.text} label="Copy CTA" />
          </div>
          <pre className="whitespace-pre-wrap rounded border border-violet/25 bg-black/30 p-2 font-mono text-[11px] text-white/85">
            {row.cta.text}
          </pre>
        </div>
      )}

      {row.thread && row.thread.length > 0 && (
        <div className="mt-3">
          <span className="font-mono text-[10px] uppercase tracking-wider text-white/40">
            Thread · {row.thread.length} posts
          </span>
          {row.thread.map((t, i) => (
            <pre
              key={i}
              className="mt-1 whitespace-pre-wrap rounded border border-white/10 bg-black/30 p-2 font-mono text-[11px] text-white/85"
            >
              {i + 1}/{row.thread!.length}
              {"\n"}
              {t}
            </pre>
          ))}
        </div>
      )}

      {row.attachments.length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {row.attachments.map((a) => (
            <AttachmentCard key={a.slot} a={a} />
          ))}
        </div>
      )}

      <Chronology row={row} />

      {row.underlying_evidence.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-white/40">
            Underlying evidence
          </p>
          {row.underlying_evidence.map((e, i) => (
            <div key={i} className="flex items-baseline gap-2 py-0.5 text-[11px]">
              <span className="text-white/50">{e.what}</span>
              <span className="font-mono font-semibold text-white/90">{e.value}</span>
              <span className="font-mono text-[10px] uppercase text-white/35">
                {surfaceLabel(e.source)}
              </span>
            </div>
          ))}
        </div>
      )}

      {row.market_outcome && (
        <div className="mt-3 rounded border border-white/10 bg-black/20 p-2">
          <p className="font-mono text-[10px] uppercase tracking-wider text-white/40">
            Outcome · measured {row.market_outcome.measured_at_et}
          </p>
          <p className="text-[11px] text-white/80">
            {row.market_outcome.what_happened}
            {row.market_outcome.move ? ` — ${row.market_outcome.move}` : ""}
          </p>
        </div>
      )}

      {!isSkip && (
        <p className="mt-3 text-[11px] text-white/55">
          <span className="font-mono text-[10px] uppercase tracking-wider text-white/40">
            Why this one:{" "}
          </span>
          {row.reason_selected}
        </p>
      )}

      {row.runners_up.length > 0 && (
        <div className="mt-2">
          <p className="mb-0.5 font-mono text-[10px] uppercase tracking-wider text-white/40">
            Passed over
          </p>
          {row.runners_up.map((r, i) => (
            <p key={i} className="text-[11px] text-white/50">
              <span className="font-mono tabular-nums text-white/40">
                {r.score.toFixed(2)}
              </span>{" "}
              {r.headline} — {r.why_not}
            </p>
          ))}
        </div>
      )}
    </GlassPanel>
  );
}

export function AdminXIntelQueuePanel() {
  const [rows, setRows] = useState<XIntelQueueRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("ALL");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/x-intel/queue?status=${status}&limit=50`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { rows: XIntelQueueRow[] };
      setRows(json.rows);
      setError(null);
    } catch (e) {
      // Distinguish "the queue is empty" from "we could not read the queue" — collapsing the two
      // would let an outage read as a quiet market, which is the one confusion this queue exists
      // to prevent.
      setError(e instanceof Error ? e.message : "load failed");
      setRows(null);
    }
  }, [status]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const counts = useMemo(() => {
    const src = rows ?? [];
    return {
      READY: src.filter((r) => r.status === "READY").length,
      REVIEW: src.filter((r) => r.status === "REVIEW").length,
      SKIP: src.filter((r) => r.status === "SKIP").length,
    };
  }, [rows]);

  // With no rows yet the panel shows the hand-written fixtures, clearly labelled. The reviewer
  // surface shipped before the generator, so an empty table is the expected first state — and a
  // blank page would leave nobody able to tell a working page from a broken one.
  const showFixtures = rows != null && rows.length === 0;
  const display = showFixtures ? X_INTEL_QUEUE_FIXTURES : (rows ?? []);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          <MetricChip label="ready" value={String(counts.READY)} tone="bull" />
          <MetricChip label="review" value={String(counts.REVIEW)} tone="amber" />
          <MetricChip label="skip" value={String(counts.SKIP)} tone="neutral" />
        </div>
        <FilterSelect
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: "ALL", label: "All" },
            { value: "READY", label: "Ready" },
            { value: "REVIEW", label: "Review" },
            { value: "SKIP", label: "Skip" },
          ]}
        />
      </div>

      {error && (
        <EmptyDeck
          title="Could not load the queue"
          hint={`${error} — this is a read failure, NOT an empty queue. Do not read it as a quiet market.`}
        />
      )}

      {showFixtures && (
        <p className="rounded border border-amber/30 bg-amber/5 px-3 py-2 font-mono text-[11px] text-amber">
          No queue rows yet — showing hand-written FIXTURES so the surface is reviewable before the
          generator exists. These are not live packages.
        </p>
      )}

      {!error && rows == null && <EmptyDeck title="Loading queue…" />}

      {display.map((row) => (
        <PackageCard key={row.cycle_key} row={row} />
      ))}
    </div>
  );
}
