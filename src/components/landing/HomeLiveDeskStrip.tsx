"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { PublicGexSnapshot, PublicGexTicker } from "@/lib/public-gex-snapshot-types";
import { MARKETING_PRODUCTS } from "@/lib/marketing/products";

function fmtLevel(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function postureLabel(posture: PublicGexSnapshot["posture"]): string {
  if (posture === "long") return "LONG γ";
  if (posture === "short") return "NEG γ";
  return "γ —";
}

/**
 * Thin cross-product strip under the hero — proves the desk is live without inventing
 * unavailable feeds.
 *
 * `gamma` is seeded server-side from the homepage route, which is `revalidate = 3600` (ISR)
 * AND force-cached at the Cloudflare edge for `edge_ttl 7200` with the bypass only on a
 * `__session` cookie — anonymous visitors (and crawlers) can get an HTML copy hours old. This
 * component used to render that seed and NEVER re-fetch — a pure server-rendered prop with no
 * client hook at all — so a single bad SSR moment (a transient upstream stall; the ALB tail-
 * latency episodes chased in FINDINGS 2026-09-02 last multiple minutes) got baked into the
 * static page and stayed "GEX snapshot initializing" for up to ~3 hours regardless of the
 * backend recovering, with nothing on the client ever correcting it. `HomeGammaPromo` (the
 * academy-section gamma panel) already carries this exact self-heal — fetch immediately on
 * mount, then poll every 5s while the tab is visible — this component now matches it.
 */
export function HomeLiveDeskStrip({ gamma: initial }: { gamma: PublicGexSnapshot }) {
  const ticker = (initial.ticker as PublicGexTicker) ?? "SPX";
  const [gamma, setGamma] = useState<PublicGexSnapshot>(initial);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/public/gex-snapshot?ticker=${ticker}`, { cache: "no-store" });
      if (!res.ok) return;
      setGamma(await res.json());
    } catch {
      /* keep showing the last good snapshot */
    }
  }, [ticker]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    let timer: number | undefined;
    const tick = () => {
      if (document.visibilityState === "visible") void load();
    };
    const start = () => {
      window.clearInterval(timer);
      timer = window.setInterval(tick, 5_000);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        tick();
        start();
      } else {
        window.clearInterval(timer);
      }
    };
    tick(); // correct a stale ISR/edge-cached seed immediately, not after a full interval
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  const hasGamma = gamma.spot != null && (gamma.available || gamma.degraded);
  const ageSec = gamma.snapshot_data_age_seconds;
  const freshness =
    ageSec == null
      ? "GEX —"
      : ageSec < 5
        ? `GEX · live · ${ageSec}s`
        : `GEX · ${ageSec}s ago`;

  const modules = MARKETING_PRODUCTS.filter((p) => p.launchStatus === "live");

  return (
    <div className="home-live-strip" aria-label="Live desk snapshot">
      <div className="w home-live-strip-inner">
        {hasGamma ? (
          <>
            <span className="home-live-chip home-live-chip--accent">
              <span className="gamma-live-dot" aria-hidden />
              {gamma.ticker} {fmtLevel(gamma.spot)}
            </span>
            <span className="home-live-chip">{postureLabel(gamma.posture)}</span>
            {gamma.flip != null ? (
              <span className="home-live-chip">FLIP {fmtLevel(gamma.flip)}</span>
            ) : null}
            {gamma.call_wall != null ? (
              <span className="home-live-chip">CALL {fmtLevel(gamma.call_wall)}</span>
            ) : null}
            {gamma.put_wall != null ? (
              <span className="home-live-chip">PUT {fmtLevel(gamma.put_wall)}</span>
            ) : null}
            <span className="home-live-chip home-live-chip--muted">{freshness}</span>
            {gamma.degraded ? (
              <span className="home-live-chip home-live-chip--warn">CACHED READ</span>
            ) : null}
          </>
        ) : (
          <span className="home-live-chip home-live-chip--warn">GEX snapshot initializing</span>
        )}
        <span className="home-live-divider" aria-hidden />
        {modules.map((m) => (
          <Link key={m.id} href={m.href} prefetch={false} className="home-live-chip home-live-chip--link">
            {m.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
