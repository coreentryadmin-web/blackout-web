"use client";

// PushNotificationToggle — Enables / disables browser push notifications for BlackOut alerts.
//
// Mount this in any settings panel, desk header, or account page. It is fully inert when
// NEXT_PUBLIC_VAPID_PUBLIC_KEY is unset or the browser doesn't support push (no-op render).
//
// State machine:
//   idle → checking (on mount) → subscribed | unsubscribed | unsupported | denied | error
//
// The button text + colour reflects the current state. A single click:
//   • unsubscribed → subscribeToPush() → subscribed (or denied/error)
//   • subscribed   → unsubscribeFromPush() → unsubscribed
//
// Relies on push-client.ts (subscribeToPush / unsubscribeFromPush) and the service worker
// registered by PwaRegister.tsx — both must be present for push to work.

import { useEffect, useState } from "react";
import {
  pushSupported,
  pushConfigured,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/push-client";

type PushState = "idle" | "checking" | "subscribed" | "unsubscribed" | "unsupported" | "denied" | "error";

interface PushNotificationToggleProps {
  /** Optional extra class names for the outer button element. */
  className?: string;
  /** When true, render as a compact icon-only button (no label text). Default false. */
  compact?: boolean;
}

export function PushNotificationToggle({ className = "", compact = false }: PushNotificationToggleProps) {
  const [state, setState] = useState<PushState>("idle");
  const [busy, setBusy] = useState(false);

  // On mount, detect current subscription state without prompting.
  useEffect(() => {
    if (!pushConfigured() || !pushSupported()) {
      setState("unsupported");
      return;
    }
    setState("checking");
    (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        setState(sub ? "subscribed" : "unsubscribed");
      } catch {
        setState("unsubscribed");
      }
    })();
  }, []);

  // Don't render anything when push is not available in this browser / env.
  if (state === "idle" || state === "unsupported") return null;

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    try {
      if (state === "subscribed") {
        const res = await unsubscribeFromPush();
        setState(res.ok ? "unsubscribed" : "error");
      } else {
        const res = await subscribeToPush();
        if (res.ok) {
          setState("subscribed");
        } else if (res.reason === "denied") {
          setState("denied");
        } else {
          setState("error");
        }
      }
    } finally {
      setBusy(false);
    }
  }

  // Labels and visual state
  const isOn = state === "subscribed";
  const isChecking = state === "checking";

  let label: string;
  let title: string;
  let colorClass: string;

  if (isChecking || busy) {
    label = "...";
    title = "Checking push status";
    colorClass = "text-cyan-400 border-cyan-800";
  } else if (isOn) {
    label = compact ? "" : "Alerts ON";
    title = "Push alerts enabled — click to disable";
    colorClass = "text-cyan-400 border-cyan-700 bg-cyan-950/40";
  } else if (state === "denied") {
    label = compact ? "" : "Blocked";
    title = "Notifications blocked in browser — update browser permissions to enable";
    colorClass = "text-sky-300 border-sky-800";
  } else if (state === "error") {
    label = compact ? "" : "Alert Error";
    title = "Push subscription failed — click to retry";
    colorClass = "text-sky-300 border-sky-800";
  } else {
    // unsubscribed
    label = compact ? "" : "Enable Alerts";
    title = "Enable real-time push alerts for GEX regime shifts and coaching signals";
    colorClass = "text-sky-300 border-sky-800 hover:border-cyan-600 hover:text-cyan-400";
  }

  // Bell icon SVG — filled when on, outline when off
  const BellIcon = () =>
    isOn ? (
      // Filled bell (subscribed)
      <svg
        className="w-4 h-4 shrink-0"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-2.83-2h5.66A3 3 0 0110 18z" />
      </svg>
    ) : (
      // Outline bell (unsubscribed / error)
      <svg
        className="w-4 h-4 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
        />
      </svg>
    );

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy || isChecking || state === "denied"}
      title={title}
      aria-label={title}
      aria-pressed={isOn}
      className={[
        "inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs font-medium",
        "transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
        colorClass,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <BellIcon />
      {!compact && <span>{label}</span>}
    </button>
  );
}
