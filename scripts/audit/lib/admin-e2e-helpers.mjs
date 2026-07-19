/**
 * Shared helpers for admin user-management + console E2E scripts.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const OUT_DIR =
  process.env.ADMIN_E2E_OUT || join(process.cwd(), "audit-output/admin-e2e");

export function ensureOutDir() {
  mkdirSync(OUT_DIR, { recursive: true });
}

export function record(name, status, detail = "") {
  const row = { name, status, detail, at: new Date().toISOString() };
  const icon =
    status === "PASS" ? "✓" : status === "WARN" ? "⚠" : status === "SKIP" ? "○" : "✗";
  console.log(`  ${icon} [${status}] ${name}${detail ? ` — ${detail}` : ""}`);
  return row;
}

export async function waitForServer(base, timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${base}/api/health`, { cache: "no-store" });
      if (res.ok) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

export async function fetchJson(base, path, { method = "GET", cookie, body } = {}) {
  const headers = { Accept: "application/json" };
  if (cookie) headers.Cookie = cookie;
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    redirect: "manual",
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _raw: text.slice(0, 500) };
  }
  return { status: res.status, json, headers: res.headers };
}

export async function fetchHtml(base, path, { cookie } = {}) {
  const headers = { Accept: "text/html" };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${base}${path}`, { headers, cache: "no-store", redirect: "follow" });
  const html = await res.text();
  return { status: res.status, html, url: res.url };
}

export function playwrightCookiesFromHeader(header, domain = "localhost") {
  return header
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf("=");
      return {
        name: pair.slice(0, eq),
        value: pair.slice(eq + 1),
        domain,
        path: "/",
        secure: false,
        sameSite: "Lax",
        httpOnly: pair.startsWith("__session"),
      };
    });
}

export function writeReport(filename, rows) {
  ensureOutDir();
  const path = join(OUT_DIR, filename);
  writeFileSync(path, JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2));
  console.log(`Report: ${path}`);
  return path;
}

export function summarize(rows) {
  const fail = rows.filter((r) => r.status === "FAIL");
  const warn = rows.filter((r) => r.status === "WARN");
  const skip = rows.filter((r) => r.status === "SKIP");
  const pass = rows.filter((r) => r.status === "PASS");
  console.log(
    `\nSummary: ${pass.length} pass, ${fail.length} fail, ${warn.length} warn, ${skip.length} skip`
  );
  return { fail, warn, skip, pass };
}
