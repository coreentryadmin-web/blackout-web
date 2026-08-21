import { existsSync } from "node:fs";
import { execSync } from "node:child_process";

/** Resolve a usable Chromium binary — cloud agents often lack /opt/pw-browsers pin. */
export function resolveChromiumPath() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }
  if (process.env.PW_CHROMIUM && existsSync(process.env.PW_CHROMIUM)) {
    return process.env.PW_CHROMIUM;
  }
  const candidates = [
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    "/home/ubuntu/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome",
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  try {
    const found = execSync(
      'find /home/ubuntu/.cache/ms-playwright /opt/pw-browsers -name chrome -type f 2>/dev/null | head -1',
      { encoding: "utf8" }
    ).trim();
    if (found) return found;
  } catch {
    /* ignore */
  }
  return undefined;
}
