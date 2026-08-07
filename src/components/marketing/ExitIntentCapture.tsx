"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { readStoredAttribution } from "@/lib/analytics/utm";

const SHOWN_FLAG_KEY = "bo_exit_intent_shown_v1";
// Don't arm detection for the first few seconds — a cursor that merely starts
// near the top of the viewport on load shouldn't trigger this before the
// visitor has actually engaged with the page.
const ARM_DELAY_MS = 4000;

function alreadyShownThisSession(): boolean {
  try {
    return sessionStorage.getItem(SHOWN_FLAG_KEY) === "1";
  } catch {
    return true; // private mode / quota — fail closed (don't show) rather than show repeatedly
  }
}

function markShown(): void {
  try {
    sessionStorage.setItem(SHOWN_FLAG_KEY, "1");
  } catch {
    /* ignore */
  }
}

type FormState = "idle" | "submitting" | "success" | "error";

/**
 * Site-wide exit-intent lead capture (docs/marketing/SEO-GROWTH.md finding #7).
 * Mounted once in MarketingPageShell so it applies to every marketing page
 * (not the authenticated desk). Fires at most once per browser session.
 */
export function ExitIntentCapture() {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [state, setState] = useState<FormState>("idle");
  const [error, setError] = useState<string | null>(null);
  const armedRef = useRef(false);

  useEffect(() => {
    if (alreadyShownThisSession()) return;
    const armTimer = setTimeout(() => {
      armedRef.current = true;
    }, ARM_DELAY_MS);

    function onMouseOut(e: MouseEvent) {
      if (!armedRef.current) return;
      // Classic desktop exit-intent: cursor leaves through the TOP of the viewport
      // (heading for the tab bar / address bar / window close), not just any edge.
      if (e.clientY > 0) return;
      if (e.relatedTarget !== null) return; // moved to another element, not off-window
      if (alreadyShownThisSession()) return;
      markShown();
      setOpen(true);
    }

    document.addEventListener("mouseout", onMouseOut);
    return () => {
      clearTimeout(armTimer);
      document.removeEventListener("mouseout", onMouseOut);
    };
  }, []);

  const handleClose = useCallback(() => setOpen(false), []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    setState("submitting");
    try {
      const attribution = readStoredAttribution();
      const res = await fetch("/api/public/email-capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: trimmed,
          sourcePath: pathname,
          utmSource: attribution?.utm_source ?? null,
          utmCampaign: attribution?.utm_campaign ?? null,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "Something went wrong — try again.");
        setState("error");
        return;
      }
      setState("success");
    } catch {
      setError("Network error — try again.");
      setState("error");
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="Before you go" size="sm">
      {state === "success" ? (
        <div className="text-center py-2">
          <p className="text-white font-semibold mb-2">Check your inbox.</p>
          <p className="text-sm text-sky-300/70">
            Your GEX cheat sheet is on its way — gamma flip, call wall, and put wall, explained.
          </p>
        </div>
      ) : (
        <>
          <p className="text-sm text-sky-300/80 mb-4">
            Get the free GEX cheat sheet — the 3-term framework for reading dealer gamma before
            you trade.
          </p>
          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 w-full rounded-lg border border-white/12 bg-white/[0.04] px-3 font-mono text-sm text-white placeholder:text-sky-300/40 focus-visible:outline-none focus-visible:border-bull/60"
              disabled={state === "submitting"}
            />
            {error && <p className="text-xs text-bear">{error}</p>}
            <button
              type="submit"
              disabled={state === "submitting"}
              className="btn-primary-bull w-full justify-center"
            >
              {state === "submitting" ? "Sending…" : "Send me the cheat sheet"}
            </button>
          </form>
          <p className="mt-3 text-[11px] text-sky-300/50">
            One email. Unsubscribe anytime by replying.
          </p>
        </>
      )}
    </Modal>
  );
}
