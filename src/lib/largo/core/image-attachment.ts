/**
 * IMAGE ATTACHMENTS — validate what a member pasted before it reaches the model.
 *
 * A member drops a chart screenshot into Largo and asks "what do you make of this?". Everything
 * between that paste and the Anthropic call happens here, and all of it is adversarial input: the
 * bytes come from the client, the declared media type comes from the client, and the size comes
 * from the client. None of the three may be trusted on its own.
 *
 * THE RULES, and why each exists:
 *
 * 1. **Bytes decide the media type, not the label.** A payload labelled `image/png` whose bytes
 *    start with `FF D8 FF` is a JPEG. Forwarding the label gets a 400 from Anthropic that surfaces
 *    to the member as "Largo query failed" with nothing to act on, so the sniffed type wins and the
 *    label is ignored. If the bytes match nothing we know, it is rejected — never guessed.
 *
 * 2. **SVG is refused explicitly**, not merely absent from the allowlist. It is the one image
 *    format that is a script-carrying document, and refusing it by name keeps a future "just add
 *    the mime type" edit from quietly opening that door.
 *
 * 3. **Size is measured from the base64 length arithmetically**, never by decoding. Decoding a
 *    payload to find out it is too large is the shape of an attack: the decode is the expensive
 *    part, and doing it before the limit check means the limit protects nothing.
 *
 * 4. **The count is capped.** Each image is billed as input tokens on EVERY subsequent round of a
 *    12-round tool loop; four large screenshots make an ordinary question cost more than the
 *    entire rest of the turn.
 *
 * PURE AND TOTAL: no IO, no throw, no network. Every failure is a returned reason string, because
 * this runs on a request path where a throw becomes a 500 and the member learns nothing.
 */

/** Media types Anthropic's vision API accepts. Anything else is rejected, not converted. */
export const SUPPORTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export type SupportedImageType = (typeof SUPPORTED_IMAGE_TYPES)[number];

/** Anthropic's per-image ceiling. Measured on DECODED bytes — what the API actually weighs. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Total decoded bytes across one turn's attachments.
 *
 * Below 4 × MAX_IMAGE_BYTES on purpose: the per-image limit is Anthropic's, this one is ours, and
 * a turn carrying 20MB of screenshots is a cost incident rather than a question.
 */
export const MAX_TOTAL_IMAGE_BYTES = 12 * 1024 * 1024;

/** More than this and the member is uploading an album, not asking about a chart. */
export const MAX_IMAGES_PER_TURN = 4;

export type RawAttachment = {
  /** Base64 payload, with or without a `data:<type>;base64,` prefix. */
  data?: unknown;
  /** What the client CLAIMS this is. Advisory only — the bytes decide. */
  media_type?: unknown;
};

export type ImageBlock = {
  type: "image";
  source: { type: "base64"; media_type: SupportedImageType; data: string };
};

export type AttachmentResult =
  | { ok: true; blocks: ImageBlock[]; totalBytes: number }
  | { ok: false; error: string };

/** Strip a `data:` URL wrapper if present, returning the bare base64 payload. */
function stripDataUrl(raw: string): string {
  const m = /^data:[^;,]*(;[^,]*)?,/.exec(raw);
  return m ? raw.slice(m[0].length) : raw;
}

/**
 * Decoded byte count, computed from the encoded length — no decode.
 *
 * base64 packs 3 bytes into 4 characters; each trailing '=' removes one byte from the final group.
 */
export function base64ByteLength(b64: string): number {
  const len = b64.length;
  if (len === 0) return 0;
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((len * 3) / 4) - padding;
}

/**
 * Identify the format from its leading bytes.
 *
 * Only the first 16 bytes are decoded — enough for every signature below, and bounded regardless of
 * how large the payload claims to be. Returns null when nothing matches, which is a rejection: a
 * file we cannot name is a file we do not forward.
 */
export function sniffImageType(b64: string): SupportedImageType | null {
  let head: Uint8Array;
  try {
    // 24 base64 chars decode to 18 bytes — past every signature we test, including WEBP's
    // "WEBP" tag at offset 8. Slicing to a multiple of 4 keeps the chunk independently decodable.
    const bin = atobCompat(b64.slice(0, 24));
    head = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null; // not decodable base64 at all
  }
  if (head.length < 4) return null;

  const at = (i: number) => head[i];
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return "image/png";
  // JPEG: every variant starts FF D8 FF
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  // GIF: "GIF8" (covers both 87a and 89a)
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38) return "image/gif";
  // WEBP: "RIFF" ....  "WEBP" — the size field between them is not checked, only the container tags.
  if (
    head.length >= 12 &&
    at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 &&
    at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/** base64 decode that works in both the Node runtime and the browser. */
function atobCompat(b64: string): string {
  if (typeof atob === "function") return atob(b64);
  return Buffer.from(b64, "base64").toString("binary");
}

/** True when the payload is syntactically base64. Rejects the whitespace/URL-safe variants too. */
function isPlainBase64(s: string): boolean {
  return s.length > 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(s);
}

/**
 * Validate a turn's attachments into Anthropic image blocks.
 *
 * Fails the WHOLE turn on the first bad attachment rather than silently dropping it. A member who
 * attached two charts and got an answer about one would have no way to tell — and the answer would
 * be confidently wrong about what it had seen, which is the failure this codebase keeps meeting.
 */
export function validateAttachments(raw: unknown): AttachmentResult {
  if (raw == null) return { ok: true, blocks: [], totalBytes: 0 };
  if (!Array.isArray(raw)) return { ok: false, error: "images must be an array" };
  if (raw.length === 0) return { ok: true, blocks: [], totalBytes: 0 };
  if (raw.length > MAX_IMAGES_PER_TURN) {
    return { ok: false, error: `too many images (max ${MAX_IMAGES_PER_TURN} per question)` };
  }

  const blocks: ImageBlock[] = [];
  let totalBytes = 0;

  for (let i = 0; i < raw.length; i++) {
    const item = raw[i] as RawAttachment;
    const label = `image ${i + 1}`;
    if (!item || typeof item !== "object") return { ok: false, error: `${label}: not an object` };

    if (typeof item.data !== "string") return { ok: false, error: `${label}: missing data` };
    const declared = typeof item.media_type === "string" ? item.media_type.toLowerCase().trim() : "";

    // Named refusal, ahead of the allowlist check, so the reason reaching the member is the real
    // one ("not supported") rather than a generic "unrecognised format".
    if (declared.includes("svg")) {
      return { ok: false, error: `${label}: SVG is not supported — paste a PNG or JPEG screenshot` };
    }

    const b64 = stripDataUrl(item.data).replace(/\s+/g, "");
    if (!isPlainBase64(b64)) return { ok: false, error: `${label}: not valid base64 image data` };

    const bytes = base64ByteLength(b64);
    if (bytes === 0) return { ok: false, error: `${label}: empty` };
    if (bytes > MAX_IMAGE_BYTES) {
      return {
        ok: false,
        error: `${label}: too large (${(bytes / 1024 / 1024).toFixed(1)}MB, max ${MAX_IMAGE_BYTES / 1024 / 1024}MB)`,
      };
    }
    totalBytes += bytes;
    if (totalBytes > MAX_TOTAL_IMAGE_BYTES) {
      return { ok: false, error: `attachments total too large (max ${MAX_TOTAL_IMAGE_BYTES / 1024 / 1024}MB)` };
    }

    // The bytes are authoritative. A mismatch with the label is not an error — phones and
    // clipboards mislabel routinely — it is simply resolved in favour of the bytes.
    const sniffed = sniffImageType(b64);
    if (!sniffed) {
      return { ok: false, error: `${label}: unrecognised image format — use PNG, JPEG, GIF or WEBP` };
    }

    blocks.push({ type: "image", source: { type: "base64", media_type: sniffed, data: b64 } });
  }

  return { ok: true, blocks, totalBytes };
}

/**
 * The instruction block added to the system prompt when a turn carries images.
 *
 * WHY THIS IS LONGER THAN "you can see an image". The failure this platform keeps producing is an
 * answer that is fluent, traceable and about the wrong thing. A screenshot is the richest possible
 * source of that failure: it has no timestamp the model can trust, no ticker it can verify, and
 * numbers that LOOK exactly like platform data once they are written into prose. Left unstated,
 * "SPX 7,750 support" read off a member's chart becomes indistinguishable, in the answer, from
 * 7,750 returned by a live quote.
 *
 * So the rule is attribution, not silence: read the chart, say it came from the chart, and check it
 * against live tools where a live equivalent exists. A disagreement between the screenshot and the
 * live number is not an inconvenience to be smoothed over — it is usually the most useful thing in
 * the answer, because it means the member is looking at something stale.
 */
export function formatImageBlock(imageCount: number): string {
  if (imageCount <= 0) return "";
  const plural = imageCount === 1 ? "image" : `${imageCount} images`;
  return `

## Attached ${plural}

The member has attached ${imageCount === 1 ? "an image" : `${imageCount} images`} to this question — typically a chart, a screenshot of a broker or another platform's panel, or a position. Read it and answer about what is actually in it.

Rules for anything you take from an image:
- **Attribute it.** Say "your chart shows…" / "the screenshot reads…". A number read off an image must never appear in the answer as though it came from a platform tool. If you cannot tell a level from a price from a volume bar, say the image is unclear rather than picking.
- **A screenshot has no reliable timestamp.** Do not assume it is current. If the time or date is visible, use it and say so; if it is not, treat the image as undated and say that too.
- **Cross-check against live data where a live equivalent exists.** If the chart is of a ticker you can quote, quote it. If the live number disagrees with the screenshot, lead with that — a stale screenshot is usually the most important thing you can tell them.
- **Do not invent what is not visible.** No indicator values, no candle counts, no exact prices you cannot actually see. "The chart does not show volume" is a real answer.
- **Identify what you cannot identify.** If the image is not a chart, or the ticker is not labelled, say what you see and ask rather than guessing an instrument.
`;
}
