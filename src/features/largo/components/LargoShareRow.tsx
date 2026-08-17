"use client";

import { useState } from "react";
import type { BieLevel } from "@/lib/bie/answer-envelope";
import { draftLargoXPost, shareLargoToDiscord } from "@/lib/api";

type ShareState = "idle" | "sending" | "done" | "err";

export function LargoShareRow({
  answer,
  headline,
  ticker,
  bias,
  levels,
}: {
  answer: string;
  headline?: string | null;
  ticker?: string | null;
  bias?: string | null;
  levels?: BieLevel[];
}) {
  const [discordState, setDiscordState] = useState<ShareState>("idle");
  const [xState, setXState] = useState<ShareState>("idle");

  return (
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
          void draftLargoXPost({ answer, headline, ticker, bias, levels })
            .then(async (draft) => {
              try {
                await navigator.clipboard.writeText(draft.text);
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
  );
}
