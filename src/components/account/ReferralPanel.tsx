"use client";

import { useEffect, useState } from "react";

/**
 * Member-facing view of their standing in Whop's native affiliate program.
 *
 * Read-only by design: Whop owns the link, the attribution, the commission and the payout. We only
 * render what it reports. Deliberately does NOT display a synthesized share link — see
 * src/lib/whop-affiliates.ts for why a guessed affiliate URL is worse than none.
 */
type Affiliate = {
  id: string;
  status: string;
  referrals: number;
  earnings: string;
  activeMembers: number;
  retentionRate: string;
  mrr: string;
  totalRevenue: string;
  username: string | null;
};

type Payload = {
  enrolled: boolean;
  affiliate: Affiliate | null;
  dashboardUrl: string;
  degraded?: boolean;
};

export function ReferralPanel() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/referrals/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled) setData(j);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dashboardUrl = data?.dashboardUrl ?? "https://whop.com/dashboard/affiliate";

  return (
    <div className="account-page-referral-block mt-8 rounded-xl border border-white/10 bg-white/[0.02] p-5">
      <h2 className="font-syne text-lg font-bold text-white">Refer &amp; Earn</h2>
      <p className="font-mono text-[11px] text-sky-300/60 mt-1 mb-4 uppercase tracking-[0.1em]">
        Affiliate program · commission paid by Whop
      </p>

      {loading ? (
        <p className="font-mono text-[11px] text-sky-300/60">Loading…</p>
      ) : data?.degraded ? (
        // Never render "0 referrals / $0.00" on an upstream failure — a member reads that as
        // "my earnings disappeared" rather than "we couldn't reach Whop right now".
        <p className="font-mono text-[11px] text-amber-300/80">
          Can&apos;t reach Whop right now, so your referral stats aren&apos;t shown. They&apos;re safe — check{" "}
          <a href={dashboardUrl} target="_blank" rel="noopener noreferrer" className="text-sky-300 hover:text-white">
            your Whop affiliate dashboard
          </a>
          .
        </p>
      ) : data?.enrolled && data.affiliate ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Referrals" value={String(data.affiliate.referrals)} />
            <Stat label="Earned" value={data.affiliate.earnings} />
            <Stat label="Active members" value={String(data.affiliate.activeMembers)} />
            <Stat label="Retention" value={data.affiliate.retentionRate} />
          </div>
          <p className="font-mono text-[11px] text-sky-300/60 mt-4 leading-relaxed">
            Grab your personal referral link and assets from{" "}
            <a href={dashboardUrl} target="_blank" rel="noopener noreferrer" className="text-sky-300 hover:text-white">
              your Whop affiliate dashboard
            </a>
            . Whop tracks every signup from your link and pays your commission directly — there&apos;s a
            30-day hold between a referred purchase and payout.
          </p>
        </>
      ) : (
        <>
          <p className="text-secondary text-sm leading-relaxed">
            Earn commission when someone joins BlackOut through your link. Whop runs the program and
            pays you directly — set up your link in a couple of clicks.
          </p>
          <a
            href={dashboardUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-outline-bull mt-4 inline-flex"
          >
            Set up referrals →
          </a>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-sky-300/60">{label}</p>
      <p className="text-white font-semibold mt-1 tabular-nums">{value}</p>
    </div>
  );
}
