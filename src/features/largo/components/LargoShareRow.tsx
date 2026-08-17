"use client";

import { useState } from "react";
import type { BieLevel } from "@/lib/bie/answer-envelope";
import type { LargoXPostDraft } from "@/lib/api";
import { draftLargoXPost, shareLargoToDiscord } from "@/lib/api";
import { detectSocialArchetype } from "@/lib/largo/social-content-core";
import { formatLargoXPost } from "@/lib/largo/format-x-post";
import { extractSocialPostTicker } from "@/lib/largo/ticker-social-guide";

type ShareState = "idle" | "sending" | "done" | "err";

function localXDraft(input: {
  answer: string;
  headline?: string | null;
  ticker?: string | null;
  bias?: string | null;
  levels?: BieLevel[];
  question?: string | null;
}): LargoXPostDraft {
  const archetype = input.question ? detectSocialArchetype(input.question) : undefined;
  const ticker =
    extractSocialPostTicker(input.question ?? "", input.ticker ?? undefined) ?? input.ticker;
  return formatLargoXPost({ ...input, ticker, archetype });
}

async function applyXDraft(draft: LargoXPostDraft, setXDraft: (d: LargoXPostDraft) => void) {
  setXDraft(draft);
  try {
    await navigator.clipboard.writeText(draft.clipboardText);
  } catch {
    /* clipboard blocked */
  }
  window.open(draft.intentUrl, "_blank", "noopener,noreferrer");
}

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
            const payload = { answer, headline, ticker, bias, levels, question };
            void draftLargoXPost(payload)
              .then(async (draft) => {
                await applyXDraft(draft, setXDraft);
                setXState("done");
              })
              .catch(async () => {
                // API may 404 during deploy — local formatter keeps workflow + clipboard working.
                await applyXDraft(localXDraft(payload), setXDraft);
                setXState("done");
              });
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
        <div className="largo-x-attachments" aria-label="Screenshot workflow for X post">
          <p className="largo-x-attachments-title">
            Screenshot workflow
            {xDraft.archetype ? ` · ${xDraft.archetype.replace(/_/g, " ")}` : ""}
          </p>
          <p className="largo-x-attachments-note">
            Attach up to 4 images on X — follow each panel in order.
          </p>
          <ol className="largo-x-attachments-list">
            {xDraft.attachments.map((a) => (
              <li key={`${a.tool}-${a.order}`}>
                <strong>
                  {a.order}. {a.tool}
                </strong>
                <span className="largo-x-attachments-label">{a.label}</span>
                <a
                  className="largo-x-attachments-path"
                  href={a.deskPath}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {a.deskPath}
                </a>
                {a.steps?.length ? (
                  <ol className="largo-x-attachment-steps">
                    {a.steps.map((step) => (
                      <li key={step.slice(0, 48)}>{step}</li>
                    ))}
                  </ol>
                ) : (
                  <span className="largo-x-attachments-hint">{a.captureHint}</span>
                )}
                <span className="largo-x-attachments-hint">
                  Capture: {a.screenshotTarget ?? a.captureHint}
                </span>
              </li>
            ))}
          </ol>
          {xDraft.altHooks?.length ? (
            <div className="largo-x-alt-hooks">
              <p className="largo-x-attachments-title">Alt hooks</p>
              <ul className="largo-x-alt-hooks-list">
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
