"use client";

import {
  MAX_IMAGE_BYTES,
  SUPPORTED_IMAGE_TYPES,
  type SupportedImageType,
} from "@/lib/largo/core/image-attachment";

/**
 * PREPARE A PASTED IMAGE for upload — resize in the browser, before it ever crosses the wire.
 *
 * A modern phone screenshot is 3–8MB and 2556px wide. Sent raw it is slow on mobile data, risks the
 * 5MB per-image ceiling, and buys nothing: Anthropic downsamples anything over ~1568px on its long
 * edge, so those extra pixels are discarded after the member has already paid to upload them.
 *
 * WHY THE FORMAT LOGIC IS NOT "always JPEG". The model's job here is to READ a chart — axis labels,
 * price ticks, thin indicator lines. JPEG's ringing artefacts land hardest on exactly that kind of
 * high-contrast thin detail, and an unreadable axis is a wrong answer, not a smaller file. So:
 *
 *   - Small enough already → sent untouched. No re-encode, no generation loss.
 *   - Needs shrinking, source was PNG → re-encode as PNG, keeping text crisp, IF that fits.
 *   - Otherwise → JPEG at descending quality until it fits.
 *
 * Everything here is browser-only (`Image`, `canvas`, `FileReader`). The server never re-encodes:
 * it validates and forwards, so this is the single place pixels are touched.
 */

/** Anthropic downsamples above this on the long edge, so more is paid for and thrown away. */
const MAX_EDGE_PX = 1568;

/** Below this, an image is sent exactly as the member supplied it — no canvas round-trip at all. */
const PASSTHROUGH_MAX_BYTES = 900 * 1024;

/** Leaves headroom under the hard per-image cap for base64 inflation and the rest of the body. */
const TARGET_MAX_BYTES = 3.5 * 1024 * 1024;

const JPEG_QUALITY_LADDER = [0.9, 0.8, 0.7, 0.6];

export type PreparedImage = {
  /** Bare base64, no data: prefix — the shape the API route expects. */
  data: string;
  media_type: SupportedImageType;
  /** Object URL for the composer thumbnail. The caller must revoke it when the chip is removed. */
  previewUrl: string;
  bytes: number;
  name: string;
};

function isSupported(t: string): t is SupportedImageType {
  return (SUPPORTED_IMAGE_TYPES as readonly string[]).includes(t);
}

/** Strip the `data:<type>;base64,` prefix a canvas/FileReader result carries. */
function bareBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result ?? ""));
    fr.onerror = () => reject(new Error("could not read file"));
    fr.readAsDataURL(file);
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("not a readable image"));
    img.src = url;
  });
}

/** Base64 length → decoded byte count, so a candidate encoding can be sized without decoding it. */
function b64Bytes(b64: string): number {
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

export class ImageRejected extends Error {}

/**
 * Turn a pasted/dropped/selected file into an upload-ready attachment.
 *
 * Throws `ImageRejected` with a member-readable reason. The caller shows it next to the composer —
 * a file that silently fails to attach is the worst outcome, because the member then asks a
 * question about a chart Largo cannot see and gets a confident answer about nothing.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const declared = (file.type || "").toLowerCase();
  if (declared.includes("svg")) {
    throw new ImageRejected("SVG isn't supported — paste a PNG or JPEG screenshot.");
  }
  if (!declared.startsWith("image/")) {
    throw new ImageRejected(`${file.name || "That file"} isn't an image.`);
  }
  if (!isSupported(declared)) {
    throw new ImageRejected("Use a PNG, JPEG, GIF or WEBP image.");
  }

  const name = file.name || "pasted image";
  const originalUrl = await readAsDataUrl(file);

  // FAST PATH — already small. Re-encoding here would only degrade it.
  if (file.size <= PASSTHROUGH_MAX_BYTES) {
    return {
      data: bareBase64(originalUrl),
      media_type: declared,
      previewUrl: URL.createObjectURL(file),
      bytes: file.size,
      name,
    };
  }

  if (file.size > MAX_IMAGE_BYTES * 4) {
    // Guard before decoding: a 40MB file would be decoded to a full bitmap in memory first.
    throw new ImageRejected(`${name} is too large (${(file.size / 1024 / 1024).toFixed(1)}MB).`);
  }

  const img = await loadImage(originalUrl).catch(() => {
    throw new ImageRejected(`${name} could not be read as an image.`);
  });

  const longEdge = Math.max(img.naturalWidth, img.naturalHeight);
  const scale = longEdge > MAX_EDGE_PX ? MAX_EDGE_PX / longEdge : 1;
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImageRejected("This browser could not process the image.");
  // Charts are line art; the smooth resampler keeps thin gridlines from aliasing into noise.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // A white ground under transparent PNGs. Without it, a transparent chart flattens onto black in
  // the JPEG branch and dark-theme axis text becomes invisible — unreadable, not merely ugly.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  const candidates: Array<{ type: SupportedImageType; url: string }> = [];
  // PNG first when the source was PNG: it is the crisp option for text and gridlines.
  if (declared === "image/png") candidates.push({ type: "image/png", url: canvas.toDataURL("image/png") });
  for (const q of JPEG_QUALITY_LADDER) {
    candidates.push({ type: "image/jpeg", url: canvas.toDataURL("image/jpeg", q) });
  }

  for (const c of candidates) {
    const data = bareBase64(c.url);
    const bytes = b64Bytes(data);
    if (bytes <= TARGET_MAX_BYTES) {
      return { data, media_type: c.type, previewUrl: c.url, bytes, name };
    }
  }

  throw new ImageRejected(`${name} is too detailed to send — try cropping to the part you're asking about.`);
}
