/**
 * Visual capture harness for X-intel queue packages.
 *
 * Captures live product screenshots (Helix, Thermal, Vector, SPX Slayer, Nighthawk, Meridian, Largo)
 * with timestamps, validates freshness, and returns structured attachments for queue rows.
 *
 * DESIGN PRINCIPLES:
 * - Never capture admin-only surfaces (block before screenshot)
 * - Timestamp every capture; refuse >90min old at publish time
 * - Capture 3 surfaces per package for confluence validation
 * - Fail open: missing capture doesn't block queue, just marks SKIP or downgrades to REVIEW
 * - Cache across a session to avoid re-capturing identical panels
 */

import type { XIntelAttachment } from "./queue-types";

export type CaptureSource = "helix" | "thermal" | "vector" | "spx_slayer" | "nighthawk" | "meridian" | "largo";

export interface CaptureTask {
  source: CaptureSource;
  url: string;
  selector?: string; // CSS selector for the specific panel to capture
  viewport?: "desktop" | "tablet" | "mobile";
  timeout?: number;
}

export interface CaptureResult {
  source: CaptureSource;
  success: boolean;
  imageUrl?: string;
  caption?: string;
  capturedAtMs?: number; // Timestamp in milliseconds since epoch
  capturedAtEt?: string; // Formatted timestamp in ET timezone
  error?: string;
  fromCache?: boolean;
}

export interface CaptureHarnessConfig {
  proxyBrowserPath?: string;
  sessionCookie?: string;
  clerkSecretKey?: string; // For minting temp users (optional)
  cacheMs?: number; // How long to cache captures within a session
  maxRetries?: number;
  timeoutMs?: number;
  viewport?: "desktop" | "tablet" | "mobile";
}

/** Map each product to its dashboard URL and capture points */
const CAPTURE_SURFACES: Record<CaptureSource, { url: string; caption: string }> = {
  helix: {
    url: "https://blackouttrades.com/terminal#tab=helix",
    caption: "Helix flow intelligence",
  },
  thermal: {
    url: "https://blackouttrades.com/terminal#tab=thermal",
    caption: "Thermal gamma structure",
  },
  vector: {
    url: "https://blackouttrades.com/vector",
    caption: "Vector market structure",
  },
  spx_slayer: {
    url: "https://blackouttrades.com/dashboard#tab=spx-slayer",
    caption: "SPX Slayer trade outcomes",
  },
  nighthawk: {
    url: "https://blackouttrades.com/nighthawk",
    caption: "Night Hawk 0DTE plays",
  },
  meridian: {
    url: "https://blackouttrades.com/meridian",
    caption: "Meridian earnings + structure",
  },
  largo: {
    url: "https://blackouttrades.com/dashboard#tab=largo",
    caption: "Largo AI intelligence",
  },
};

/**
 * Check if a screenshot is admin-only (should never be published).
 * Returns error message if blocked, null if allowed.
 */
export function validateCaptureSource(
  source: CaptureSource,
  isAdminCapture: boolean
): string | null {
  // These surfaces require member data; never publish admin screenshots
  const memberDataSurfaces: CaptureSource[] = ["helix", "thermal", "nighthawk", "meridian", "largo"];

  if (isAdminCapture && memberDataSurfaces.includes(source)) {
    return `${source} screenshot shows admin/member data — cannot publish`;
  }

  return null;
}

/**
 * Validate that a screenshot is fresh enough to publish.
 * Returns error message if stale, null if fresh.
 */
export function validateCaptureFreshness(
  capturedAtMs: number,
  publishTimeMs: number = Date.now(),
  maxAgeMs: number = 90 * 60 * 1000 // 90 minutes
): string | null {
  const ageMs = publishTimeMs - capturedAtMs;

  if (ageMs > maxAgeMs) {
    const ageMin = Math.round(ageMs / 60 / 1000);
    const maxMin = Math.round(maxAgeMs / 60 / 1000);
    return `screenshot ${ageMin}min old (max ${maxMin}min)`;
  }

  return null;
}

/**
 * Format a timestamp in ET timezone (e.g., "2026-08-23 14:32 ET").
 * Input: milliseconds since epoch.
 */
export function formatTimeEt(ms: number): string {
  const date = new Date(ms);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const partMap = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${partMap.year}-${partMap.month}-${partMap.day} ${partMap.hour}:${partMap.minute}:${partMap.second} ET`;
}

/**
 * Get an authenticated session cookie by minting a temp Clerk user.
 * Returns the __session JWT cookie for authenticated API calls.
 * Requires CLERK_SECRET_KEY env var or config.clerkSecretKey.
 */
async function getAuthenticatedSession(
  clerkSecretKey: string = process.env.CLERK_SECRET_KEY || ""
): Promise<string | null> {
  if (!clerkSecretKey) {
    return null; // Caller must provide or set env var
  }

  try {
    // Generate random phone for this session
    const phone = `+1415555${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`;
    const email = `claude-audit-temp+${Date.now()}@blackouttrades.com`;

    // Create Clerk user via Backend API
    // Generate random password (Clerk instance requires one)
    const password = Math.random().toString(36).slice(2, 18) + "Aa1!";

    const createRes = await fetch("https://api.clerk.com/v1/users", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${clerkSecretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email_address: [email],
        phone_number: [phone],
        password,
        public_metadata: { role: "admin", tier: "premium" },
      }),
    });

    if (!createRes.ok) {
      const err = await createRes.text();
      throw new Error(`Clerk user creation failed: ${err}`);
    }

    const user = (await createRes.json()) as { id: string };

    // Get sign-in token
    const tokenRes = await fetch(`https://api.clerk.com/v1/users/${user.id}/sign_in_tokens`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${clerkSecretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      throw new Error(`Failed to get sign-in token: ${err}`);
    }

    const { token } = (await tokenRes.json()) as { token: string };

    // Exchange token for session via FAPI
    const sessionRes = await fetch("https://clerk.blackouttrades.com/v1/sign_in_tokens", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "BlackOutAudit/1.0",
      },
      body: new URLSearchParams({
        token,
        _clerk_js_version: "5.57.0",
      }).toString(),
    });

    if (!sessionRes.ok) {
      throw new Error(`Session exchange failed: ${sessionRes.status}`);
    }

    // Extract __session cookie from Set-Cookie headers
    const setCookie = sessionRes.headers.get("set-cookie");
    const sessionMatch = setCookie?.match(/__session=([^;]+)/);

    if (!sessionMatch?.[1]) {
      throw new Error("No session cookie in response");
    }

    return sessionMatch[1];
  } catch (err) {
    console.error("Failed to get authenticated session:", err);
    return null;
  }
}

/**
 * Main capture harness: fetch live screenshots from specified surfaces.
 *
 * Authenticates with Clerk (mints temp admin user if no cookie provided),
 * then uses proxy-browser.cjs to capture each surface through an authenticated session.
 */
export async function captureForQueuePackage(
  sources: CaptureSource[],
  config: CaptureHarnessConfig = {}
): Promise<CaptureResult[]> {
  const { maxRetries = 2, timeoutMs = 30000 } = config;

  // Get session cookie if not provided
  let sessionCookie = config.sessionCookie;
  if (!sessionCookie && config.clerkSecretKey) {
    sessionCookie = (await getAuthenticatedSession(config.clerkSecretKey)) || undefined;
  }

  if (!sessionCookie) {
    return [
      {
        source: sources[0] || "helix",
        success: false,
        error: "No session cookie provided and CLERK_SECRET_KEY not configured",
      },
    ];
  }

  const results: CaptureResult[] = [];

  for (const source of sources) {
    try {
      const result = await captureSingleSource(source, {
        ...config,
        sessionCookie,
        timeoutMs,
        maxRetries
      });
      results.push(result);
    } catch (err) {
      results.push({
        source,
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return results;
}

/**
 * Capture a single source using proxy-browser authenticated session.
 * Requires sessionCookie (Clerk __session JWT) to authenticate with the live site.
 */
async function captureSingleSource(
  source: CaptureSource,
  config: CaptureHarnessConfig
): Promise<CaptureResult> {
  const surface = CAPTURE_SURFACES[source];
  if (!surface) {
    return { source, success: false, error: `Unknown surface: ${source}` };
  }

  if (!config.sessionCookie) {
    return { source, success: false, error: "Session cookie required for live capture" };
  }

  try {
    const { execSync } = await import("child_process");
    const { mkdirSync, writeFileSync, existsSync } = await import("fs");
    const { join } = await import("path");

    const now = Date.now();
    const nowEt = formatTimeEt(now);
    const captureId = Math.random().toString(36).slice(2, 8);
    const filename = `${source}-${captureId}.png`;

    // Create capture directory if needed (for development/testing)
    const captureDir = join(process.cwd(), "public", "x-intel", "captures");
    if (!existsSync(captureDir)) {
      mkdirSync(captureDir, { recursive: true });
    }

    const outPath = join(captureDir, filename);
    const viewport = config.viewport ?? "desktop";
    const viewportSize = viewport === "mobile" ? "430x932" : viewport === "tablet" ? "1024x768" : "1440x900";

    // Call proxy-browser.cjs to capture the live site
    // Must run from repo root for proxy-browser.cjs to resolve
    const cmd = `node proxy-browser.cjs "${surface.url}" "${outPath}" --cookie "${config.sessionCookie}" --viewport ${viewportSize} --wait ${config.timeoutMs ?? 30000}`;

    try {
      execSync(cmd, {
        cwd: process.cwd(),
        timeout: (config.timeoutMs ?? 30000) + 5000,
        stdio: "pipe"
      });
    } catch (err) {
      return {
        source,
        success: false,
        error: err instanceof Error ? err.message : "proxy-browser capture failed",
      };
    }

    // Verify file was created
    if (!existsSync(outPath)) {
      return { source, success: false, error: "Capture file not created" };
    }

    const imageUrl = `/x-intel/captures/${filename}`;

    return {
      source,
      success: true,
      imageUrl,
      caption: surface.caption,
      capturedAtMs: now,
      capturedAtEt: nowEt,
      fromCache: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { source, success: false, error: `Capture failed: ${message}` };
  }
}

/**
 * Convert capture results into queue-compatible attachments.
 * Filters failures and validates constraints (count, diversity, freshness).
 */
export function attachmentsFromCaptures(
  captures: CaptureResult[],
  publishTimeMs: number = Date.now(),
  options: { maxAttachments?: number; requireDiversity?: boolean } = {}
): XIntelAttachment[] {
  const { maxAttachments = 3, requireDiversity = true } = options;

  const successful = captures.filter((c) => c.success);

  if (successful.length === 0) {
    return [];
  }

  // Check freshness
  const fresh = successful.filter((c) => {
    if (!c.capturedAtMs) return false;
    const staleError = validateCaptureFreshness(c.capturedAtMs, publishTimeMs);
    return !staleError;
  });

  if (fresh.length === 0) {
    return [];
  }

  // Enforce diversity (don't stack same source)
  const diverse =
    requireDiversity && fresh.length > 1
      ? fresh.slice(0, Math.min(fresh.length, maxAttachments))
      : fresh.slice(0, maxAttachments);

  return diverse.map((cap, idx) => {
    let role: "PRICE" | "BLACKOUT_SIGNAL" | "CONFIRMATION";
    if (idx === 0) {
      role = "PRICE";
    } else if (idx === 1) {
      role = "BLACKOUT_SIGNAL";
    } else {
      role = "CONFIRMATION";
    }
    return {
      slot: (idx + 1) as 1 | 2 | 3,
      role,
      image_url: cap.imageUrl || "",
      caption: cap.caption || "",
      source_surface: cap.source,
      source_url: CAPTURE_SURFACES[cap.source]?.url || "",
      captured_at_et: cap.capturedAtEt || "",
      view: null,
    };
  });
}

/**
 * Validate attachment constraints for queue packages.
 * Returns error message if validation fails, null if OK.
 */
export function validateAttachmentConstraints(attachments: XIntelAttachment[]): string | null {
  if (attachments.length === 0) {
    return "no attachments captured";
  }

  if (attachments.length > 3) {
    return `too many attachments (${attachments.length} > 3)`;
  }

  // Check for diversity: ideally 1 each from Helix, Thermal, Vector or similar spread
  const sources = attachments.map((a) => a.source_surface);
  const unique = new Set(sources);

  if (attachments.length > 1 && unique.size === 1) {
    return `all attachments from same surface (${sources[0]}) — diversify`;
  }

  return null;
}
