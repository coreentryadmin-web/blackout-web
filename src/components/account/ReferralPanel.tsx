"use client";

import { useCallback, useEffect, useState } from "react";

type LoadState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; link: string; signedUp: number; converted: number };

/** Self-serve referral link + stats — /api/referrals/me does the real work. */
export function ReferralPanel() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/referrals/me", { cache: "no-store" });
      if (!res.ok) {
        setState({ kind: "error" });
        return;
      }
      const data = (await res.json()) as {
        link: string;
        stats: { signedUp: number; converted: number };
      };
      setState({
        kind: "ready",
        link: data.link,
        signedUp: data.stats.signedUp,
        converted: data.stats.converted,
      });
    } catch {
      setState({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.kind === "loading") {
    return (
      <p className="font-mono text-[11px] text-sky-300/80" aria-busy>
        Loading your referral link…
      </p>
    );
  }
  if (state.kind === "error") {
    return <p className="font-mono text-[11px] text-sky-300/60">Could not load referral link.</p>;
  }

  async function handleCopy() {
    if (state.kind !== "ready") return;
    try {
      await navigator.clipboard.writeText(state.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — link is still selectable text */
    }
  }

  return (
    <div className="space-y-3">
      <p className="font-mono text-[11px] text-sky-300/60 leading-relaxed">
        Share your link. When someone signs up through it, it shows up here — and again once
        they go paid.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          readOnly
          value={state.link}
          onFocus={(e) => e.currentTarget.select()}
          className="h-9 flex-1 min-w-[220px] rounded-lg border border-white/12 bg-white/[0.04] px-3 font-mono text-[12px] text-white"
        />
        <button type="button" onClick={handleCopy} className="btn-outline-bull">
          {copied ? "Copied!" : "Copy link"}
        </button>
      </div>
      <div className="flex gap-6 pt-1">
        <div>
          <p className="font-mono text-lg font-bold text-white tabular-nums">{state.signedUp}</p>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-sky-300/60">Signed up</p>
        </div>
        <div>
          <p className="font-mono text-lg font-bold text-white tabular-nums">{state.converted}</p>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-sky-300/60">Went paid</p>
        </div>
      </div>
    </div>
  );
}
