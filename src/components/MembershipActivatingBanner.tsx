"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppAuth } from "@/lib/auth-client";
import { readRememberedPlan } from "@/lib/analytics/checkout-plans";
import {
  isPaidTier,
  MEMBERSHIP_ACTIVATION_MAX_ATTEMPTS,
  MEMBERSHIP_ACTIVATION_POLL_MS,
  shouldPollMembershipActivation,
  tierFromMembershipSyncBody,
} from "@/lib/membership-activating";

/**
 * Post-checkout activation UX (CLQ-041): when a member returns signed-in but tier is still free,
 * show an activating banner and poll `/api/membership/sync` until access lands or we time out.
 */
export function MembershipActivatingBanner() {
  const router = useRouter();
  const { isLoaded, isSignedIn, tier } = useAppAuth();
  const [rememberedPlan, setRememberedPlan] = useState<ReturnType<typeof readRememberedPlan>>(null);
  const [attempts, setAttempts] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const activeRef = useRef(true);

  useEffect(() => {
    setRememberedPlan(readRememberedPlan());
  }, [isLoaded, isSignedIn, tier]);

  const visible = shouldPollMembershipActivation({
    isLoaded,
    isSignedIn,
    tier,
    rememberedPlan,
  });

  useEffect(() => {
    if (!visible) return;
    activeRef.current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      if (!activeRef.current) return;
      setSyncing(true);
      try {
        const res = await fetch("/api/membership/sync", { method: "POST" });
        const data = await res.json().catch(() => null);
        const syncedTier = tierFromMembershipSyncBody(data);
        if (syncedTier && isPaidTier(syncedTier)) {
          router.refresh();
          return;
        }
        if (res.status === 429) {
          const retryAfter = Number(res.headers.get("Retry-After"));
          const delayMs =
            Number.isFinite(retryAfter) && retryAfter > 0
              ? retryAfter * 1000
              : MEMBERSHIP_ACTIVATION_POLL_MS;
          timer = setTimeout(poll, delayMs);
          return;
        }
      } catch {
        /* network blip — keep polling */
      } finally {
        setSyncing(false);
      }

      setAttempts((n) => {
        const next = n + 1;
        if (next < MEMBERSHIP_ACTIVATION_MAX_ATTEMPTS && activeRef.current) {
          timer = setTimeout(poll, MEMBERSHIP_ACTIVATION_POLL_MS);
        }
        return next;
      });
    };

    void poll();
    return () => {
      activeRef.current = false;
      if (timer) clearTimeout(timer);
    };
  }, [visible, router]);

  if (!visible) return null;

  const timedOut = attempts >= MEMBERSHIP_ACTIVATION_MAX_ATTEMPTS;

  return (
    <div
      role="status"
      aria-live="polite"
      // z-[105]: `.nav-bar` (globals.css) is `z-[100]` and, on every non-home route this banner
      // can mount on, `data-scrolled` defaults to "true" on first render (Nav.tsx), making
      // `.nav-surface` fully opaque immediately — no scroll needed. At the banner's old z-[90] it
      // sat behind that opaque bar from the very first paint, so the only UI telling a member
      // their payment is still activating was permanently invisible. Must stay above 100.
      className="fixed inset-x-0 top-0 z-[105] border-b border-cyan-400/30 bg-[rgba(6,10,18,0.96)] px-4 py-2.5 text-center backdrop-blur-md"
    >
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-cyan-200">
        {timedOut ? (
          <>
            Membership still activating —{" "}
            <Link href="/upgrade" className="text-bull underline underline-offset-2">
              tap sync on upgrade
            </Link>{" "}
            or wait a moment and refresh.
          </>
        ) : (
          <>
            Activating membership{syncing ? "…" : ""} — desk access unlocks automatically once
            payment confirms.
          </>
        )}
      </p>
    </div>
  );
}
