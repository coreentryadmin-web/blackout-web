"use client";

import { useState } from "react";
import type { BieLevel } from "@/lib/bie/answer-envelope";
import type { LargoXPostDraft } from "@/lib/api";
import { draftLargoXPost, shareLargoToDiscord } from "@/lib/api";

type ShareState = "idle" | "sending" | "done" | "err";

export function LargoShareRow({
  answer,
  headline,
  ticker,
  bias,
  levels,
  question,
}: {
  answer: string;
  headline?: string | null;
  ticker?: string | null;
  bias?: string | null;
  levels?: BieLevel[];
  question?: string | null;
}) {
  const [discordState, setDiscordState] = useState<ShareState>("idle");
  const [xState, setXState] = useState<ShareState>("idle");
  const [xDraft, setXDraft] = useState<LargoXPostDraft | null>(null);

  return (
    <div className="largo-share-block">
      <div className="largo-share-row">
        <button
          type="button"
          className="largo-share-discord-btn"
          disabled={discordState === "sending"}
          onClick={() => {
            setDiscordState("sending");
            void shareLargoToDiscord({ answer, headline, ticker })
              .then(() => setDiscordState("done"))
              .catch(() => setDiscordState("err"));
          }}
        >
          {discordState === "done"
            ? "Shared"
            : discordState === "err"
              ? "Share failed"
              : "Share to Discord"}
        </button>
        <button
          type="button"
          className="largo-share-discord-btn"
          disabled={xState === "sending"}
          onClick={() => {
            setXState("sending");
            void draftLargoXPost({ answer, headline, ticker, bias, levels, question })
              .then(async (draft) => {
                setXDraft(draft);
                try {
                  await navigator.clipboard.writeText(draft.clipboardText);
                } catch {
                  /* clipboard blocked — intent URL still opens compose */
                }
                window.open(draft.intentUrl, "_blank", "noopener,noreferrer");
                setXState("done");
              })
              .catch(() => setXState("err"));
          }}
        >
          {xState === "done"
            ? "Copied for X"
            : xState === "err"
              ? "X draft failed"
              : "Copy for X"}
        </button>
      </div>
      {xDraft?.attachments?.length ? (
        <div className="largo-x-attachments" aria-label="Suggested X post images">
          <p className="largo-x-attachments-title">
            Attach from these desks
            {xDraft.archetype ? ` · ${xDraft.archetype.replace(/_/g, " ")}` : ""}
          </p>
          <ol className="largo-x-attachments-list">
            {xDraft.attachments.map((a) => (
              <li key={`${a.tool}-${a.order}`}>
                <strong>{a.tool}</strong>
                <span className="largo-x-attachments-label">{a.label}</span>
                <a
                  className="largo-x-attachments-path"
                  href={a.deskPath}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {a.deskPath}
                </a>
                <span className="largo-x-attachments-hint">{a.captureHint}</span>
              </li>
            ))}
          </ol>
          {xDraft.altHooks?.length ? (
            <div className="largo-x-alt-hooks">
              <p className="largo-x-attachments-title">Alt hooks</p>
              <ul className="largo-x-attachments-list">
                {xDraft.altHooks.map((hook) => (
                  <li key={hook}>{hook}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
