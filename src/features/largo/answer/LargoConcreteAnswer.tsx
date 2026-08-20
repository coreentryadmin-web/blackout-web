"use client";

import { clsx } from "clsx";
import type { BieAnswerEnvelope } from "@/lib/bie/answer-envelope";
import { LargoMessageBody } from "@/features/largo/components/LargoMessageBody";
import { renderInlineMarkdown } from "@/features/largo/components/inline-markdown";
import { LargoAnswerCaveats } from "@/features/largo/answer/LargoAnswerCaveats";
import { splitAnswerCaveats } from "@/features/largo/answer/answer-caveats";
import { splitHeadline } from "@/features/largo/answer/headline";

function formatEt(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d)} ET`;
}

/**
 * Talon-style concrete read — verdict + one dense paragraph, no card chrome.
 */
export function LargoConcreteAnswer({
  content,
  envelope,
  className,
}: {
  content: string;
  envelope?: BieAnswerEnvelope | null;
  className?: string;
}) {
  const { body, caveats } = splitAnswerCaveats(content);
  const headline = envelope?.headline?.trim() ?? "";
  const { header, rest } = headline ? splitHeadline(headline) : { header: "", rest: "" };
  const verdict = header || rest.split(/[.—]\s/)[0]?.trim() || "";

  return (
    <article className={clsx("largo-concrete-answer", className)}>
      {envelope?.asOf ? (
        <div className="largo-concrete-meta font-mono">
          <span className="largo-concrete-mark">Largo</span>
          <span className="largo-concrete-asof">{formatEt(envelope.asOf)}</span>
        </div>
      ) : null}

      {verdict ? (
        <p className="largo-concrete-verdict">{renderInlineMarkdown(verdict)}</p>
      ) : null}

      <LargoMessageBody
        content={body}
        className={clsx("largo-concrete-body", verdict && "largo-concrete-body-after-verdict")}
      />

      <LargoAnswerCaveats caveats={caveats} />
    </article>
  );
}
