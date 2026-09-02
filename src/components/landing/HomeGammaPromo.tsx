"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { BorderBeam } from "@/components/ui/motion/BorderBeam";
import { RetroGrid } from "@/components/ui/motion/RetroGrid";
import type { PublicGexSnapshot, PublicGexTicker } from "@/lib/public-gex-snapshot-types";
import { publicGexTickers } from "@/lib/public-gex-snapshot-types";

const TICKERS = publicGexTickers();

function fmtLevel(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function fmtAge(snapshot: PublicGexSnapshot, loading: boolean): string {
  if (loading) return "Refreshing…";
  if (snapshot.degraded) {
    const age = snapshot.snapshot_data_age_seconds;
    if (age != null && age < 3600) return `cached · ${age < 60 ? `${age}s` : `${Math.round(age / 60)}m`} ago`;
    return "cached read";
  }
  if (!snapshot.available) return snapshot.warming_reason === "warming" ? "initializing" : "unavailable";
  if (snapshot.snapshot_data_age_seconds != null) {
    const s = snapshot.snapshot_data_age_seconds;
    if (s < 5) return "live";
    if (s < 60) return `${s}s ago`;
    const mins = Math.round(s / 60);
    if (mins === 1) return "1m ago";
    return `${mins}m ago`;
  }
  return fmtAgeFromAsof(snapshot.asof);
}

function fmtAgeFromAsof(asof: string | null): string {
  if (!asof) return "warming";
  const ms = Date.now() - new Date(asof).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "live";
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins === 1) return "1m ago";
  return `${mins}m ago`;
}

type Props = {
  initial: PublicGexSnapshot;
  variant?: "band" | "academy";
};

export function HomeGammaPromo({ initial, variant = "band" }: Props) {
  const [ticker, setTicker] = useState<PublicGexTicker>(initial.ticker as PublicGexTicker);
  const [snapshot, setSnapshot] = useState<PublicGexSnapshot>(initial);
  const [loading, setLoading] = useState(false);

  const loadTicker = useCallback(async (next: PublicGexTicker) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/public/gex-snapshot?ticker=${next}`, { cache: "no-store" });
      if (res.ok) setSnapshot(await res.json());
    } catch {
      /* keep last good read */
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Fetch IMMEDIATELY on mount, then every 5s while visible.
   *
   * The mount fetch is the load-bearing part. This panel is seeded server-side from the homepage,
   * which is `revalidate = 3600` (ISR) AND force-cached at the Cloudflare edge for `edge_ttl 7200`
   * with the bypass only on a `__session` cookie — i.e. exactly the anonymous visitors this promo
   * exists for get an HTML copy that can be HOURS old. The previous interval-only effect left that
   * seed on screen for a full 2 minutes under a pulsing "live" dot before the first refresh, which
   * is the one thing a levels panel must never do.
   *
   * Visibility-gated: a backgrounded tab stops polling (and browsers throttle hidden timers into
   * unpredictable bursts anyway), and returning to the tab repaints before waiting out an interval.
   */
  useEffect(() => {
    if (typeof document === "undefined") return;
    let timer: number | undefined;
    const tick = () => {
      if (document.visibilityState === "visible") void loadTicker(ticker);
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
    tick();
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [loadTicker, ticker]);

  async function selectTicker(next: PublicGexTicker) {
    if (next === ticker) return;
    setTicker(next);
    await loadTicker(next);
  }

  const showLevels = Boolean(snapshot.spot != null && (snapshot.available || snapshot.degraded));
  const isLong = snapshot.posture === "long";
  const isShort = snapshot.posture === "short";
  const spot = snapshot.spot;
  const flip = snapshot.flip;
  const call = snapshot.call_wall;
  const put = snapshot.put_wall;

  const ladder =
    spot != null && flip != null && call != null && put != null
      ? buildLadder(spot, call, flip, put)
      : null;

  if (variant === "academy") {
    return (
      <Link href="/tools/gamma-snapshot" prefetch={false} className="gamma-academy-teaser">
        <BorderBeam color="var(--rl-cyan)" duration="5.5s" width="1.5px" delay="-2s" />
        <div className="gamma-academy-teaser-inner">
          <div className="gamma-academy-teaser-head">
            <span className="gamma-live-dot" aria-hidden />
            <span className="gamma-academy-tag">Free live tool</span>
            <span className="gamma-academy-fresh">{fmtAge(snapshot, loading)}</span>
          </div>
          <h3>Gamma flip &amp; wall levels</h3>
          <p>No sign-in — SPX, SPY, QQQ flip, call wall, put wall, and regime.</p>
          {showLevels && (
            <div className="gamma-academy-levels" aria-hidden>
              <span className="gamma-lvl gamma-lvl-call">{fmtLevel(call)}</span>
              <span className="gamma-lvl gamma-lvl-flip">{fmtLevel(flip)}</span>
              <span className="gamma-lvl gamma-lvl-put">{fmtLevel(put)}</span>
            </div>
          )}
          <span className="gamma-academy-go">Open snapshot →</span>
        </div>
      </Link>
    );
  }

  return (
    <section className="sec-free-gamma" id="free-gamma">
      <div className="w">
        <div className="gamma-promo-shell">
          <RetroGrid lineColor="rgba(34,211,238,0.12)" opacity={0.35} />
          <BorderBeam color="var(--rl-cyan)" duration="7s" width="1.6px" />
          <BorderBeam color="var(--rl-bull)" duration="11s" width="1px" delay="-4s" />

          <div className="gamma-promo-layout">
            <div className="gamma-promo-copy">
              <span className="kk">
                <span className="dot" />
                Free desk preview · no account
              </span>
              <h2>
                Dealer gamma,<br />
                <span className="gt">on the glass.</span>
              </h2>
              <p>
                The gamma flip, call wall, and put wall that pin or accelerate SPX — the same structural
                read members trade on Thermal, distilled into a free snapshot.
              </p>
              <ul className="gamma-promo-bullets">
                <li>Live SPX · SPY · QQQ</li>
                <li>Long / short gamma regime</li>
                <li>Refreshes live every 5 seconds</li>
              </ul>
            </div>

            <div className="gamma-promo-panel">
              <div className="gamma-promo-chrome">
                <div className="gamma-promo-chrome-dots" aria-hidden>
                  <span />
                  <span />
                  <span />
                </div>
                <span className="gamma-promo-chrome-title">Gamma snapshot · public</span>
                <span className="gamma-promo-chrome-live">
                  <span className="gamma-live-dot" aria-hidden />
                  {loading ? "Syncing" : snapshot.degraded ? "Cached" : "Live"}
                </span>
              </div>

              <div className="gamma-promo-body">
                <div className="gamma-promo-toolbar">
                  <div className="gamma-ticker-pills" role="tablist" aria-label="Index ticker">
                    {TICKERS.map((t) => (
                      <button
                        key={t}
                        type="button"
                        role="tab"
                        aria-selected={t === ticker}
                        className={"gamma-ticker-pill" + (t === ticker ? " is-active" : "")}
                        onClick={() => void selectTicker(t)}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                  <span className="gamma-promo-age">{fmtAge(snapshot, loading)}</span>
                </div>

                {!showLevels ? (
                  <div className="gamma-promo-warm">
                    <span className="gamma-promo-warm-scan" aria-hidden />
                    <p>{snapshot.read}</p>
                  </div>
                ) : (
                  <>
                    {snapshot.degraded ? (
                      <p className="gamma-promo-degraded" role="status">
                        {snapshot.degraded_note ?? "Showing last known levels — live refresh temporarily unavailable."}
                      </p>
                    ) : null}
                    <div className="gamma-promo-headline">
                      <div>
                        <p className="gamma-promo-kicker">{snapshot.ticker} spot</p>
                        <p className="gamma-promo-spot">{fmtLevel(spot)}</p>
                      </div>
                      <div
                        className={
                          "gamma-regime-badge" +
                          (isLong ? " is-long" : isShort ? " is-short" : "")
                        }
                      >
                        <span className="gamma-regime-label">Regime</span>
                        <span className="gamma-regime-value">
                          {isLong ? "Long γ" : isShort ? "Short γ" : "—"}
                        </span>
                      </div>
                    </div>

                    <div className="gamma-promo-matrix">
                      <div className="gamma-level-tile gamma-level-call">
                        <span className="gamma-level-val">{fmtLevel(call)}</span>
                        <span className="gamma-level-key">Call wall</span>
                      </div>
                      <div className="gamma-level-tile gamma-level-flip">
                        <span className="gamma-level-val">{fmtLevel(flip)}</span>
                        <span className="gamma-level-key">Gamma flip</span>
                      </div>
                      <div className="gamma-level-tile gamma-level-put">
                        <span className="gamma-level-val">{fmtLevel(put)}</span>
                        <span className="gamma-level-key">Put wall</span>
                      </div>
                    </div>

                    {ladder && (
                      <div className="gamma-ladder" aria-hidden>
                        <div className="gamma-ladder-track">
                          {ladder.map((row) => (
                            <div
                              key={row.key}
                              className={"gamma-ladder-row" + (row.kind ? ` is-${row.kind}` : "")}
                              style={{ "--gamma-row-pct": `${row.pct}%` } as CSSProperties}
                            >
                              <span className="gamma-ladder-tag">{row.label}</span>
                              <span className="gamma-ladder-bar" />
                              <span className="gamma-ladder-num">{fmtLevel(row.value)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <p className="gamma-promo-read">{snapshot.read}</p>
                  </>
                )}

                <div className="gamma-promo-scan" aria-hidden />

                <Link href="/tools/gamma-snapshot" prefetch={false} className="btn-p gamma-promo-cta">
                  Open full snapshot <span className="cta-arrow">&rarr;</span>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

type LadderRow = {
  key: string;
  label: string;
  value: number;
  kind: "call" | "flip" | "put" | "spot" | null;
  pct: number;
};

function buildLadder(spot: number, call: number, flip: number, put: number): LadderRow[] {
  const lo = Math.min(put, flip, call, spot) * 0.998;
  const hi = Math.max(put, flip, call, spot) * 1.002;
  const span = hi - lo || 1;
  const pct = (v: number) => Math.max(8, Math.min(92, ((hi - v) / span) * 100));

  return [
    { key: "call", label: "CALL", value: call, kind: "call", pct: pct(call) },
    { key: "spot", label: "SPOT", value: spot, kind: "spot", pct: pct(spot) },
    { key: "flip", label: "FLIP", value: flip, kind: "flip", pct: pct(flip) },
    { key: "put", label: "PUT", value: put, kind: "put", pct: pct(put) },
  ];
}

/** Hero CTA — live pulse + cyan edge glow */
export function HomeGammaHeroLink() {
  return (
    <Link href="/tools/gamma-snapshot" prefetch={false} className="btn-g btn-gamma-live">
      <span className="gamma-live-dot" aria-hidden />
      Free gamma snapshot
    </Link>
  );
}
