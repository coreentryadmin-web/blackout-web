import { parseLargoBlockPayload, type LargoBlock } from "./schema";

/**
 * Split a Largo answer into prose and component segments.
 *
 * The answer is markdown that may contain ```blackout fenced JSON payloads. Everything outside a
 * fence renders through the existing markdown path unchanged; each fence becomes zero or more
 * components. See schema.ts for why the wire format is fenced blocks rather than one JSON document.
 *
 * STREAMING IS THE HARD PART. This runs on PARTIAL text on every token, so it must handle a fence
 * that has opened and not yet closed. An unterminated fence is treated as PENDING and its content
 * is withheld — never emitted as prose. Emitting it would splatter raw JSON across the terminal for
 * the seconds it takes the block to finish, which is worse than showing nothing and then showing
 * the finished component. `pendingBlock` lets the caller render a skeleton in that gap.
 */

export type LargoSegment =
  | { kind: "prose"; text: string }
  | { kind: "block"; block: LargoBlock }
  /** A fence has opened but not closed — mid-stream. Render a skeleton, never the raw payload. */
  | { kind: "pending" };

/** Opening fence: ```blackout (also accepts ```json blackout and ```blk for tolerance). */
const FENCE_OPEN = /^[ \t]*```[ \t]*(?:blackout|blk|json[ \t]+blackout)[ \t]*$/i;
const FENCE_CLOSE = /^[ \t]*```[ \t]*$/;

export function extractLargoSegments(markdown: string): LargoSegment[] {
  if (!markdown) return [];
  const lines = markdown.split(/\r?\n/);
  const out: LargoSegment[] = [];
  let prose: string[] = [];
  let payload: string[] | null = null;

  const flushProse = () => {
    const text = prose.join("\n");
    // Whitespace-only prose between two blocks would render as an empty paragraph and add a gap
    // the designer never asked for.
    if (text.trim()) out.push({ kind: "prose", text });
    prose = [];
  };

  for (const line of lines) {
    if (payload == null) {
      if (FENCE_OPEN.test(line)) {
        flushProse();
        payload = [];
        continue;
      }
      prose.push(line);
      continue;
    }
    if (FENCE_CLOSE.test(line)) {
      for (const block of parseLargoBlockPayload(payload.join("\n"))) out.push({ kind: "block", block });
      payload = null;
      continue;
    }
    payload.push(line);
  }

  if (payload != null) {
    // Unterminated fence — still streaming, or the model never closed it. Either way the payload
    // is withheld. A block that never closes simply never renders, which is the right failure:
    // the prose around it is intact and the member is not shown a wall of JSON.
    out.push({ kind: "pending" });
  } else {
    flushProse();
  }
  return out;
}

/** True when the answer carries at least one renderable component. */
export function hasLargoBlocks(markdown: string): boolean {
  return extractLargoSegments(markdown).some((s) => s.kind === "block");
}

/**
 * The answer with every ```blackout fence removed, for surfaces that cannot render components —
 * conversation history replay, the claim verifier, persistence, notifications.
 *
 * The VERIFIER matters most here. It traces numbers in the answer back to the turn's tool results;
 * if the JSON payload were left in, every strike, price and count inside a block would be counted
 * twice — once in the component and once in the raw JSON — skewing the coverage ratio that decides
 * whether a member sees the low-confidence caveat.
 */
export function stripLargoBlocks(markdown: string): string {
  return extractLargoSegments(markdown)
    .filter((s): s is { kind: "prose"; text: string } => s.kind === "prose")
    .map((s) => s.text)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
