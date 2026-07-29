import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Cron HTTP responses must not echo raw Error.message (hostnames, PG text, provider
 * bodies) — log detail server-side / logCronRun, return a fixed public string.
 */
const CRON_DIR = join(process.cwd(), "src/app/api/cron");

function cronRouteFiles(): string[] {
  const out: string[] = [];
  for (const name of readdirSync(CRON_DIR)) {
    const route = join(CRON_DIR, name, "route.ts");
    try {
      readFileSync(route);
      out.push(route);
    } catch {
      /* no route.ts */
    }
  }
  return out;
}

test("cron routes do not return raw error detail/message in HTTP JSON", () => {
  const leaks: string[] = [];
  for (const file of cronRouteFiles()) {
    const src = readFileSync(file, "utf8");
    // Patterns that put the caught Error.message into the HTTP body.
    if (/return NextResponse\.json\(\{ ok: false, error: detail/.test(src)) {
      leaks.push(`${file}: error: detail`);
    }
    if (/return NextResponse\.json\(\{ ok: false, error: message/.test(src)) {
      leaks.push(`${file}: error: message`);
    }
    if (/error: "[^"]+", detail \}/.test(src) || /error: '[^']+', detail \}/.test(src)) {
      leaks.push(`${file}: detail field on error response`);
    }
  }
  assert.deepEqual(leaks, [], `HTTP error-detail leaks:\n${leaks.join("\n")}`);
});
