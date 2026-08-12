"use client";

import { extractLargoSegments } from "@/features/largo/blocks/extract";
import { LargoBlockView } from "@/features/largo/blocks/LargoBlocks";

/**
 * Renders ```blackout fenced components from the model answer.
 *
 * Desk read parses prose into the envelope but strips fences — this surfaces the model's
 * comparison/levels/callout blocks without re-parsing the full markdown body.
 */
export function LargoAnswerBlocks({ content }: { content: string }) {
  const segments = extractLargoSegments(content).filter((s) => s.kind === "block");
  if (!segments.length) return null;
  return (
    <div className="largo-answer-blocks">
      {segments.map((seg, i) =>
        seg.kind === "block" ? <LargoBlockView key={i} block={seg.block} /> : null
      )}
    </div>
  );
}

/** True when the answer carries renderable blackout blocks (not pending). */
export function hasRenderedLargoBlocks(content: string): boolean {
  return extractLargoSegments(content).some((s) => s.kind === "block");
}
