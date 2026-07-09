"use client";

import { clsx } from "clsx";
import type { PlaybookShadowPanel } from "@/features/spx/lib/playbook-shadow-panel";

type Props = {
  panel: PlaybookShadowPanel | null | undefined;
};

export function SpxPlaybookShadowStrip({ panel }: Props) {
  if (!panel?.verdicts.length) return null;

  return (
    <div className="spx-playbook-shadow-strip" aria-label="Playbook shadow matcher (staging)">
      <div className="spx-playbook-shadow-strip-head">
        <span className="spx-playbook-shadow-strip-kicker">Playbook</span>
        <span className="spx-playbook-shadow-strip-badge">Shadow</span>
      </div>
      <div className="spx-playbook-shadow-strip-row">
        {panel.verdicts.map((v) => {
          const active = v.trigger_fired;
          const armed = v.precondition_match && v.session_window_open;
          return (
            <div
              key={v.playbook_id}
              className={clsx(
                "spx-playbook-shadow-chip",
                active && "spx-playbook-shadow-chip--trigger",
                !active && armed && "spx-playbook-shadow-chip--armed",
                v.primary && active && "spx-playbook-shadow-chip--primary"
              )}
              title={v.detail}
            >
              <span className="spx-playbook-shadow-chip-id">{v.playbook_id}</span>
              <span className="spx-playbook-shadow-chip-name">{v.name}</span>
              {active ? (
                <span
                  className={clsx(
                    "spx-playbook-shadow-chip-dir",
                    v.direction === "long" && "text-bull",
                    v.direction === "short" && "text-bear-text"
                  )}
                >
                  {v.direction === "neutral" ? "—" : v.direction.toUpperCase()}
                </span>
              ) : (
                <span className="spx-playbook-shadow-chip-state">
                  {v.session_window_open ? (armed ? "ARMED" : "WATCH") : "CLOSED"}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
