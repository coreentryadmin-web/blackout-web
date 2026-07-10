"use client";

import { clsx } from "clsx";
import type { PlaybookShadowPanel } from "@/features/spx/lib/playbook-shadow-panel";

type Props = {
  panel: PlaybookShadowPanel | null | undefined;
  sessionLive?: boolean;
};

export function SpxPlaybookValidationPanel({ panel, sessionLive = true }: Props) {
  return (
    <section className="spx-playbook-validation-panel" aria-label="Playbook validation shadow">
      <header className="spx-playbook-validation-header">
        <h4 className="spx-playbook-validation-title">Playbook Validation</h4>
        <span className="spx-playbook-validation-badge">Shadow</span>
      </header>

      {!panel?.verdicts.length ? (
        <p className="spx-playbook-validation-empty">
          {sessionLive
            ? "Playbook matcher arms when technicals load — PB-01/02/03 shadow verdicts appear here."
            : "After hours — last session shadow verdicts refresh on the slow poll; open a chip above for structure detail."}
        </p>
      ) : (
        <div className="spx-playbook-validation-grid">
          {panel.verdicts.map((v) => {
            const active = v.trigger_fired;
            const armed = v.precondition_match && v.session_window_open;
            return (
              <article
                key={v.playbook_id}
                className={clsx(
                  "spx-playbook-validation-row",
                  active && "spx-playbook-validation-row--trigger",
                  !active && armed && "spx-playbook-validation-row--armed",
                  v.primary && active && "spx-playbook-validation-row--primary"
                )}
              >
                <div className="spx-playbook-validation-row-head">
                  <span className="spx-playbook-validation-id">{v.playbook_id}</span>
                  <span className="spx-playbook-validation-name">{v.name}</span>
                  {v.primary && active && (
                    <span className="spx-playbook-validation-primary">Primary</span>
                  )}
                </div>
                <dl className="spx-playbook-validation-metrics">
                  <div>
                    <dt>Window</dt>
                    <dd>{v.session_window_open ? "Open" : "Closed"}</dd>
                  </div>
                  <div>
                    <dt>Preconditions</dt>
                    <dd>{v.precondition_match ? "Met" : "—"}</dd>
                  </div>
                  <div>
                    <dt>Trigger</dt>
                    <dd>{v.trigger_fired ? (v.direction === "neutral" ? "Fired" : v.direction) : "—"}</dd>
                  </div>
                </dl>
                <p className="spx-playbook-validation-detail">{v.detail}</p>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
