"use client";

import { memo, useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { useFocusTrap } from "@/components/ui/useFocusTrap";
import { VectorAlertsPanel } from "@/features/vector/components/VectorAlertsPanel";
import type { AlertRule, AlertKind, FiredAlert } from "@/features/vector/lib/vector-alerts";

type Props = {
  ticker: string;
  rules: AlertRule[];
  recent: FiredAlert[];
  onAdd: (kind: AlertKind, tolerancePct?: number) => void;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  notifyEnabled?: boolean;
  notifyPermission?: NotificationPermission;
  onToggleNotify?: () => void;
  className?: string;
};

/**
 * Alerts moved off the page (member: "I don't think anyone right now is using Alerts on Vector —
 * we might as well remove it and just add a clickable icon next to LIVE SESSION on the top and it
 * gives us options", 2026-08-27). This is that icon: a bell button that anchors a popover holding
 * the UNCHANGED `VectorAlertsPanel` (same ticker/condition/threshold/add form, same rule list,
 * same notify toggle, same onAdd/onToggle/onRemove/onToggleNotify wiring) — nothing about alert
 * evaluation or firing moved, only the container it lives in.
 *
 * Follows the click-outside pattern already used by `Select` (src/components/ui/Select.tsx) and
 * the shared `useFocusTrap` hook (src/components/ui/useFocusTrap.ts) used by every hand-rolled
 * dialog in this repo — there is no generic Popover primitive to reuse (checked: the only
 * "Popover" hits in the codebase are Clerk's own `userButtonPopoverCard` theme keys, not a
 * component), so this composes the two existing building blocks rather than introducing a new
 * dependency. `lockScroll: false` because a small anchored popover shouldn't freeze page scroll
 * the way a full modal does.
 */
export const VectorAlertsBell = memo(function VectorAlertsBell({
  ticker,
  rules,
  recent,
  onAdd,
  onToggle,
  onRemove,
  notifyEnabled,
  notifyPermission,
  onToggleNotify,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useFocusTrap(popoverRef, {
    active: open,
    onEscape: () => setOpen(false),
    lockScroll: false,
  });

  // Click-outside-to-close — same approach as Select.tsx's own dropdown.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const activeCount = rules.filter((r) => r.enabled).length;

  return (
    <div ref={wrapRef} className={clsx("vector-alerts-bell-wrap", className)}>
      <button
        type="button"
        className="vector-alerts-bell-btn"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Alerts${activeCount > 0 ? ` — ${activeCount} active` : ""}`}
        title="Alerts"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 2.5c-1.4 0-2.5 1.1-2.5 2.5v.6C7 6.4 5 8.9 5 12v4l-1.6 2.1c-.3.4 0 1 .5 1h16.2c.5 0 .8-.6.5-1L19 16v-4c0-3.1-2-5.6-4.5-6.4V5c0-1.4-1.1-2.5-2.5-2.5Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path d="M9.5 20a2.5 2.5 0 0 0 5 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        {activeCount > 0 && <span className="vector-alerts-bell-dot" aria-hidden="true" />}
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="vector-alerts-bell-popover"
          role="dialog"
          aria-label={`${ticker} alerts`}
          tabIndex={-1}
        >
          <VectorAlertsPanel
            ticker={ticker}
            rules={rules}
            recent={recent}
            onAdd={onAdd}
            onToggle={onToggle}
            onRemove={onRemove}
            notifyEnabled={notifyEnabled}
            notifyPermission={notifyPermission}
            onToggleNotify={onToggleNotify}
          />
        </div>
      )}
    </div>
  );
});
