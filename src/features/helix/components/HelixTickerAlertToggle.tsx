"use client";

import { useCallback, useEffect, useState } from "react";
import { clsx } from "clsx";
import { subscribeToPush, pushConfigured } from "@/lib/push-client";

type Rule = { ticker: string; minPremium: number; side: "CALL" | "PUT" | null; enabled: boolean };

/**
 * Per-ticker HELIX flow alert toggle — sits next to TickerDrawer's star/watchlist button, same
 * bell-icon pattern Vector uses, but scoped to exactly ONE rule per ticker (see
 * helix-alert-rules-core.ts's header for why this doesn't need Vector's multi-rule panel). Owns
 * all of its own fetch/save state — TickerDrawer only passes `ticker`, no lifted state needed.
 *
 * Delivery is server push only (no in-page/localStorage tier to build here — unlike Vector, HELIX
 * has no existing client-side per-ticker evaluation loop to hook into; every print already flows
 * through one server-side choke point in flow-persist.ts, so that's where matching happens). On
 * first save, this also prompts for OS notification permission via the shared subscribeToPush()
 * helper (src/lib/push-client.ts) — inert no-op if VAPID isn't configured client-side, matching
 * the server hook's own inert-by-default gate.
 */
export function HelixTickerAlertToggle({ ticker }: { ticker: string }) {
  const [open, setOpen] = useState(false);
  const [rule, setRule] = useState<Rule | null>(null);
  const [loading, setLoading] = useState(false);
  const [minPremiumInput, setMinPremiumInput] = useState("500000");
  const [side, setSide] = useState<"ALL" | "CALL" | "PUT">("ALL");
  const [saving, setSaving] = useState(false);
  const [pushPrompted, setPushPrompted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRule(null);
    if (!ticker) return;
    setLoading(true);
    fetch(`/api/helix/alerts/rules?ticker=${encodeURIComponent(ticker)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { rule: Rule | null } | null) => {
        if (cancelled) return;
        if (data?.rule) {
          setRule(data.rule);
          setMinPremiumInput(String(data.rule.minPremium));
          setSide(data.rule.side ?? "ALL");
        }
      })
      .catch(() => {
        /* best-effort — the toggle just shows "no alert set" on a fetch failure */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  const save = useCallback(
    async (enabled: boolean) => {
      const minPremium = Math.max(1, Number(minPremiumInput) || 500000);
      setSaving(true);
      try {
        const res = await fetch("/api/helix/alerts/rules", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ticker,
            minPremium,
            side: side === "ALL" ? null : side,
            enabled,
          }),
        });
        if (res.ok) {
          setRule({ ticker, minPremium, side: side === "ALL" ? null : side, enabled });
          // Best-effort, fire-and-forget — a member who declines/ignores the OS prompt still has
          // the rule saved server-side; it just won't have anywhere to deliver to yet. Only prompt
          // once per mount (not on every save) so toggling the rule off/on doesn't re-prompt.
          if (enabled && !pushPrompted && pushConfigured()) {
            setPushPrompted(true);
            void subscribeToPush();
          }
        }
      } catch {
        /* best-effort — local UI state already optimistically reflects the intended save below */
      } finally {
        setSaving(false);
      }
    },
    [ticker, minPremiumInput, side, pushPrompted]
  );

  const remove = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/helix/alerts/rules", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker }),
      });
      if (res.ok) setRule(null);
    } catch {
      /* best-effort */
    } finally {
      setSaving(false);
    }
  }, [ticker]);

  if (!ticker) return null;

  const active = !!rule?.enabled;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={active ? `Flow alert active on ${ticker} — click to edit` : `Set a flow alert on ${ticker}`}
        aria-pressed={active}
        aria-expanded={open}
        disabled={loading}
        className={clsx(
          "tap44 leading-none text-[20px] transition-colors",
          active ? "text-gold" : "text-cyan-400 hover:text-gold"
        )}
      >
        {active ? "🔔" : "🔕"}
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-20 w-[240px] rounded-lg border border-white/10 bg-[#0b0e16] p-3 shadow-xl">
          <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-cyan-500 mb-2">
            Alert on {ticker}
          </p>
          <label className="block mb-2">
            <span className="font-mono text-[10px] text-white/50">Min premium</span>
            <div className="flex items-center gap-1 mt-1">
              <span className="font-mono text-[12px] text-white/60">$</span>
              <input
                type="number"
                min={1}
                step={10000}
                value={minPremiumInput}
                onChange={(e) => setMinPremiumInput(e.target.value)}
                className="w-full rounded border border-white/10 bg-black/40 px-2 py-1 font-mono text-[12px] text-white"
                aria-label="Minimum premium"
              />
            </div>
          </label>
          <label className="block mb-3">
            <span className="font-mono text-[10px] text-white/50">Side</span>
            <select
              value={side}
              onChange={(e) => setSide(e.target.value as "ALL" | "CALL" | "PUT")}
              className="mt-1 w-full rounded border border-white/10 bg-black/40 px-2 py-1 font-mono text-[12px] text-white"
              aria-label="Option side"
            >
              <option value="ALL">Calls + Puts</option>
              <option value="CALL">Calls only</option>
              <option value="PUT">Puts only</option>
            </select>
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => save(true)}
              className="flex-1 rounded bg-gold/90 px-2 py-1.5 font-mono text-[11px] font-semibold text-black hover:bg-gold disabled:opacity-50"
            >
              {active ? "Update" : "Enable"}
            </button>
            {rule && (
              <button
                type="button"
                disabled={saving}
                onClick={remove}
                className="rounded border border-white/10 px-2 py-1.5 font-mono text-[11px] text-white/60 hover:text-white disabled:opacity-50"
              >
                Remove
              </button>
            )}
          </div>
          <p className="mt-2 font-mono text-[9px] text-white/40">
            Push notification when a {ticker} print clears your threshold.
          </p>
        </div>
      )}
    </div>
  );
}
