import Link from "next/link";
import type { PublicGexSnapshot } from "@/lib/public-gex-snapshot-types";
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

/** Thin cross-product strip under the hero — proves the desk is live without inventing unavailable feeds. */
export function HomeLiveDeskStrip({ gamma }: { gamma: PublicGexSnapshot }) {
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
