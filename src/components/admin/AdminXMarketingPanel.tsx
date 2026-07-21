"use client";

import { useCallback, useEffect, useState } from "react";
import { clsx } from "clsx";
import { GlassPanel, MegaStat, MetricChip } from "@/components/admin/AdminUi";
import type { XAdminAnalytics, XCronRunSummary } from "@/lib/admin-x-analytics";

const REFRESH_MS = 60_000;

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function BudgetChip({
  label,
  used,
  cap,
}: {
  label: string;
  used: number;
  cap: number;
}) {
  const pct = cap > 0 ? used / cap : 0;
  const tone: "bull" | "bear" | "amber" | "neutral" =
    pct >= 1 ? "bear" : pct >= 0.75 ? "amber" : "bull";
  return (
    <MetricChip
      label={label}
      value={`${used}/${cap}`}
      tone={tone}
    />
  );
}

function CronRow({ row }: { row: XCronRunSummary }) {
  const ok = row.status === "ok" || row.status === "skipped";
  const engageBits = [
    row.likes != null ? `${row.likes}♥` : null,
    row.quotes != null && row.quotes > 0 ? `${row.quotes} QT` : null,
    row.replies != null && row.replies > 0 ? `${row.replies}↩` : null,
    row.follows != null && row.follows > 0 ? `${row.follows}+` : null,
    row.skipped403 != null && row.skipped403 > 0 ? `${row.skipped403} skip403` : null,
    row.postType ? row.postType : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex items-start justify-between gap-2 border-b border-white/5 py-2 last:border-0">
      <div className="min-w-0">
        <p className="font-mono text-[11px] font-semibold text-white/90">{row.job_key}</p>
        <p className="font-mono text-[10px] text-white/45 truncate">
          {engageBits || row.message || "—"}
        </p>
      </div>
      <div className="flex flex-shrink-0 flex-col items-end gap-0.5">
        <span
          className={clsx(
            "font-mono text-[10px] font-bold uppercase",
            ok ? "text-bull" : row.status === "unknown" ? "text-white/40" : "text-bear",
          )}
        >
          {row.status}
        </span>
        <span className="font-mono text-[10px] text-cyan/70">
          {row.started_at ? timeAgo(row.started_at) : "—"}
        </span>
      </div>
    </div>
  );
}

export function AdminXMarketingPanel() {
  const [data, setData] = useState<XAdminAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastAt, setLastAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/analytics/x", { cache: "no-store" });
      if (!res.ok) throw new Error(`${res.status}`);
      const json = (await res.json()) as XAdminAnalytics;
      setData(json);
      setError(null);
      setLastAt(new Date().toISOString());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const d = data;
  const delta = d?.follower_delta;
  const deltaLabel =
    delta == null ? "24h Δ n/a" : delta >= 0 ? `+${delta} 24h` : `${delta} 24h`;

  return (
    <GlassPanel
      title="@BlackOutTrade"
      accent="violet"
      kicker={`X marketing · ${d?.x_api_configured ? "API ok" : "API keys missing"} · ${timeAgo(lastAt)}`}
    >
      {loading && !d ? (
        <div className="mt-2 space-y-2">
          {[1, 2, 3].map((n) => (
            <div key={n} className="admin-skeleton h-10 rounded" />
          ))}
        </div>
      ) : error ? (
        <p className="font-mono text-[11px] text-bear py-4 text-center">{error}</p>
      ) : d ? (
        <div className="mt-2 space-y-4">
          {d.rate_limit_paused && (
            <p className="rounded-lg border border-bear/40 bg-bear/10 px-3 py-2 font-mono text-[11px] text-bear">
              X writes paused until {d.rate_limit_until ? timeAgo(d.rate_limit_until) : "window clears"}
            </p>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <MegaStat
              label="Followers"
              value={d.followers.toLocaleString()}
              tone={delta != null && delta > 0 ? "bull" : "neutral"}
              sub={deltaLabel}
            />
            <MegaStat
              label="Avg impressions"
              value={Math.round(d.avg_impressions).toLocaleString()}
              tone={d.avg_impressions >= 100 ? "bull" : "amber"}
              sub={`snapshot ${timeAgo(d.snapshot_at)}`}
            />
            <MegaStat
              label="Avg likes"
              value={d.avg_likes.toFixed(1)}
              tone={d.avg_likes >= 1 ? "bull" : "amber"}
              sub={`${d.recent_posts.length} recent posts`}
            />
            <MegaStat
              label="Posts today"
              value={`${d.budget_today.posts}/${d.budget_today.caps.posts}`}
              tone={
                d.budget_today.posts >= d.budget_today.caps.posts ? "amber" : "neutral"
              }
              sub="desk autopost budget"
            />
          </div>

          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-cyan mb-2">
              Today&apos;s budget (ET)
            </p>
            <div className="flex flex-wrap gap-2">
              <BudgetChip label="Likes" used={d.budget_today.likes} cap={d.budget_today.caps.likes} />
              <BudgetChip label="Follows" used={d.budget_today.follows} cap={d.budget_today.caps.follows} />
              <BudgetChip label="Visible" used={d.budget_today.replies} cap={d.budget_today.caps.replies} />
              <BudgetChip label="RTs" used={d.budget_today.retweets} cap={d.budget_today.caps.retweets} />
            </div>
          </div>

          {d.best_post && (
            <div className="rounded-lg border border-gold/25 bg-gold/5 px-3 py-2">
              <p className="font-mono text-[10px] uppercase tracking-widest text-gold mb-1">
                Best recent post · score {d.best_post.engagement_score}
              </p>
              <p className="font-mono text-[11px] text-white/80 leading-relaxed">
                {d.best_post.text}
              </p>
              <p className="font-mono text-[10px] text-white/45 mt-1">
                {d.best_post.impressions} imp · {d.best_post.likes}♥ · {d.best_post.replies}💬
              </p>
            </div>
          )}

          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-cyan mb-2">
              Cron last run
            </p>
            <div className="rounded-lg border border-white/10 bg-black/20 px-3">
              {d.crons.map((c) => (
                <CronRow key={c.job_key} row={c} />
              ))}
            </div>
          </div>

          {d.recent_posts.length > 0 && (
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-cyan mb-2">
                Recent timeline
              </p>
              <div className="max-h-48 overflow-y-auto rounded-lg border border-white/10 bg-black/20 divide-y divide-white/5">
                {d.recent_posts.slice(0, 8).map((t) => (
                  <div key={t.id} className="px-3 py-2">
                    <p className="font-mono text-[10px] text-white/75 line-clamp-2">{t.text}</p>
                    <p className="font-mono text-[10px] text-white/40 mt-0.5">
                      {t.impressions} imp · {t.likes}♥ · {t.replies}💬 · score {t.engagement_score}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {d.insights.length > 0 && (
            <ul className="space-y-1 font-mono text-[10px] text-white/55 list-disc pl-4">
              {d.insights.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void load()}
              className="font-mono text-[10px] text-cyan hover:text-sky-200 transition-colors"
            >
              ↺ refresh
            </button>
          </div>
        </div>
      ) : null}
    </GlassPanel>
  );
}
