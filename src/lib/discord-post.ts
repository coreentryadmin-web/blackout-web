// Shared Discord webhook POST with delivery confirmation + single fallback retry.
// Pure / alias-free at runtime (only depends on global fetch) so it is unit-testable
// under `tsx --test`. Contract: NEVER throws into callers (fire-and-forget). On any
// failure it logs at error and, if DISCORD_FALLBACK_WEBHOOK_URL is set and distinct
// from the primary, retries the same payload to it exactly once.
//
// SECURITY: webhook URLs embed a secret token. We NEVER log the URL or token value;
// we log only a non-reversible label + host so operators can tell which channel failed.

export interface DiscordEmbedPayload {
  title?: string;
  description?: string;
  color?: number;
  url?: string;
  timestamp?: string;
  footer?: { text: string; icon_url?: string };
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  author?: { name: string; url?: string; icon_url?: string };
  /** Inline attachment reference (e.g. attachment://thermal-desk.png). */
  image?: { url: string };
}

/** Text and/or embeds — Discord accepts either (or both). */
export interface DiscordPayload {
  content?: string;
  embeds?: DiscordEmbedPayload[];
}

export interface DiscordFileAttachment {
  /** Filename Discord shows (e.g. thermal-desk.png). */
  filename: string;
  /** Raw file bytes. */
  bytes: Uint8Array | Buffer;
  /** MIME type — defaults to image/png. */
  contentType?: string;
}

/** Redact a webhook URL to host only (no path/token) for safe logging. */
export function redactWebhook(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "<invalid-url>";
  }
}

async function postOnce(url: string, payload: DiscordPayload): Promise<{ ok: boolean; status: number | null; error?: unknown }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { ok: res.ok, status: res.status };
  } catch (error) {
    return { ok: false, status: null, error };
  }
}

async function postOnceWithFiles(
  url: string,
  payload: DiscordPayload,
  files: DiscordFileAttachment[]
): Promise<{ ok: boolean; status: number | null; error?: unknown }> {
  try {
    const form = new FormData();
    form.append("payload_json", JSON.stringify(payload));
    files.forEach((file, i) => {
      const type = file.contentType ?? "image/png";
      // Copy into a fresh ArrayBuffer-backed Uint8Array so BlobPart typing is happy under TS 5.x.
      const src = file.bytes instanceof Uint8Array ? file.bytes : new Uint8Array(file.bytes);
      const copy = new Uint8Array(src.byteLength);
      copy.set(src);
      const blob = new Blob([copy], { type });
      form.append(`files[${i}]`, blob, file.filename);
    });
    // wait=true so Discord returns 200 only after the message is accepted (better delivery signal).
    const sep = url.includes("?") ? "&" : "?";
    const res = await fetch(`${url}${sep}wait=true`, { method: "POST", body: form });
    return { ok: res.ok, status: res.status };
  } catch (error) {
    return { ok: false, status: null, error };
  }
}

/**
 * POST `payload` to `primaryUrl`, confirming delivery via res.ok. On failure,
 * log at error and retry once to DISCORD_FALLBACK_WEBHOOK_URL (if set and different).
 * Returns true if either delivery succeeded. Never throws.
 *
 * `label` is a short caller tag (e.g. "spx-play", "ops") used only in logs.
 */
export async function postDiscordWebhook(
  primaryUrl: string,
  payload: DiscordPayload,
  label: string
): Promise<boolean> {
  const primary = await postOnce(primaryUrl, payload);
  if (primary.ok) return true;

  console.error(
    `[discord-post:${label}] primary webhook delivery failed`,
    {
      host: redactWebhook(primaryUrl),
      status: primary.status,
      error: primary.error instanceof Error ? primary.error.message : primary.error,
    }
  );

  const fallbackUrl = process.env.DISCORD_FALLBACK_WEBHOOK_URL?.trim();
  if (!fallbackUrl || fallbackUrl === primaryUrl) return false;

  const fallback = await postOnce(fallbackUrl, payload);
  if (fallback.ok) {
    console.error(`[discord-post:${label}] delivered via fallback webhook`, {
      host: redactWebhook(fallbackUrl),
    });
    return true;
  }

  console.error(`[discord-post:${label}] fallback webhook delivery also failed`, {
    host: redactWebhook(fallbackUrl),
    status: fallback.status,
    error: fallback.error instanceof Error ? fallback.error.message : fallback.error,
  });
  return false;
}

/**
 * POST text + file attachments (multipart) to a Discord webhook.
 * Same never-throw / fallback contract as `postDiscordWebhook`.
 */
export async function postDiscordWebhookWithFiles(
  primaryUrl: string,
  payload: DiscordPayload,
  files: DiscordFileAttachment[],
  label: string
): Promise<boolean> {
  if (!files.length) return postDiscordWebhook(primaryUrl, payload, label);

  const primary = await postOnceWithFiles(primaryUrl, payload, files);
  if (primary.ok) return true;

  console.error(`[discord-post:${label}] primary webhook (multipart) delivery failed`, {
    host: redactWebhook(primaryUrl),
    status: primary.status,
    error: primary.error instanceof Error ? primary.error.message : primary.error,
    files: files.length,
  });

  const fallbackUrl = process.env.DISCORD_FALLBACK_WEBHOOK_URL?.trim();
  if (!fallbackUrl || fallbackUrl === primaryUrl) return false;

  const fallback = await postOnceWithFiles(fallbackUrl, payload, files);
  if (fallback.ok) {
    console.error(`[discord-post:${label}] multipart delivered via fallback webhook`, {
      host: redactWebhook(fallbackUrl),
    });
    return true;
  }

  console.error(`[discord-post:${label}] fallback multipart webhook also failed`, {
    host: redactWebhook(fallbackUrl),
    status: fallback.status,
    error: fallback.error instanceof Error ? fallback.error.message : fallback.error,
  });
  return false;
}
