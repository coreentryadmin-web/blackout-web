#!/usr/bin/env node
/**
 * Vector chart interaction perf probe — measures wheel/pan responsiveness on prod.
 *
 * Usage:
 *   node scripts/audit/vector-chart-interaction-perf.mjs [--base=https://blackouttrades.com]
 *
 * Requires CLERK_SECRET_KEY + NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import {
  mintIosPlaywrightSession,
  onboardingInitScript,
  dismissDeskModals,
} from "./lib/ios-playwright-auth.mjs";

const baseArg = process.argv.find((a) => a.startsWith("--base="));
const BASE = (baseArg ? baseArg.slice("--base=".length) : "https://blackouttrades.com").replace(
  /\/$/,
  ""
);
const OUT = process.env.VECTOR_PERF_DIR || "/opt/cursor/artifacts/vector-interaction-perf";
mkdirSync(OUT, { recursive: true });

async function main() {
  const auth = await mintIosPlaywrightSession({ appUrl: BASE, tier: "premium", role: "admin" });
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  });
  await context.addInitScript(onboardingInitScript);
  await context.addCookies(auth.cookies);
  const page = await context.newPage();

  const report = { base: BASE, at: new Date().toISOString(), checks: [] };
  const rec = (name, status, detail, extra = {}) => {
    report.checks.push({ name, status, detail, ...extra });
    console.log(`  [${status}] ${name}${detail ? " — " + detail : ""}`);
  };

  try {
    await page.goto(`${BASE}/vector?ticker=SPY`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForSelector("canvas", { timeout: 90_000 });
    await dismissDeskModals(page);
    await page.waitForTimeout(3500);
    await dismissDeskModals(page);

    const canvasCount = await page.locator("canvas").count();
    if (canvasCount < 1) {
      rec("PAGE-LOAD", "RED", "no chart canvas found");
      throw new Error("no canvas");
    }
    rec("PAGE-LOAD", "GREEN", `${canvasCount} canvas(es)`);

    await page.screenshot({ path: join(OUT, "vector-before-interaction.png"), fullPage: false });

    const metrics = await page.evaluate(async () => {
      const canvas = document.querySelector("canvas");
      if (!canvas) return { error: "no canvas" };

      const longTasks = [];
      try {
        const obs = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            longTasks.push({ start: e.startTime, duration: e.duration, name: e.name });
          }
        });
        obs.observe({ type: "longtask", buffered: true });
      } catch {
        /* unsupported */
      }

      const rect = canvas.getBoundingClientRect();
      const cx = rect.left + rect.width * 0.45;
      const cy = rect.top + rect.height * 0.5;

      const wheelSamples = [];
      const chartContainer = canvas.parentElement;

      const wheelStart = performance.now();
      for (let i = 0; i < 25; i++) {
        const t0 = performance.now();
        canvas.dispatchEvent(
          new WheelEvent("wheel", {
            bubbles: true,
            cancelable: true,
            clientX: cx,
            clientY: cy,
            deltaY: i % 2 === 0 ? -120 : 120,
          })
        );
        wheelSamples.push(performance.now() - t0);
        await new Promise((r) => requestAnimationFrame(r));
      }
      const wheelBurstMs = performance.now() - wheelStart;

      // Drag pan simulation
      const panSamples = [];
      const panStart = performance.now();
      canvas.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: cx, clientY: cy, buttons: 1 }));
      for (let i = 0; i < 30; i++) {
        const t0 = performance.now();
        canvas.dispatchEvent(
          new MouseEvent("mousemove", {
            bubbles: true,
            clientX: cx + i * 8,
            clientY: cy,
            buttons: 1,
          })
        );
        panSamples.push(performance.now() - t0);
        await new Promise((r) => requestAnimationFrame(r));
      }
      canvas.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: cx + 240, clientY: cy }));
      const panBurstMs = performance.now() - panStart;

      const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
      const p95 = (arr) => {
        if (!arr.length) return 0;
        const s = [...arr].sort((a, b) => a - b);
        return s[Math.floor(s.length * 0.95)] ?? s[s.length - 1];
      };

      return {
        wheelBurstMs,
        wheelAvgMs: avg(wheelSamples),
        wheelP95Ms: p95(wheelSamples),
        wheelMaxMs: Math.max(...wheelSamples, 0),
        panBurstMs,
        panAvgMs: avg(panSamples),
        panP95Ms: p95(panSamples),
        panMaxMs: Math.max(...panSamples, 0),
        longTaskCount: longTasks.length,
        longTaskTotalMs: longTasks.reduce((s, t) => s + t.duration, 0),
        longTasks: longTasks.slice(-20),
        containerTag: chartContainer?.tagName ?? null,
        canvasSize: { w: rect.width, h: rect.height },
      };
    });

    if (metrics.error) {
      rec("INTERACTION", "RED", metrics.error);
    } else {
      const wheelSlow = metrics.wheelP95Ms > 16 || metrics.wheelMaxMs > 50;
      const panSlow = metrics.panP95Ms > 16 || metrics.panMaxMs > 50;
      rec(
        "WHEEL-ZOOM",
        wheelSlow ? "AMBER" : "GREEN",
        `burst=${metrics.wheelBurstMs.toFixed(0)}ms avg=${metrics.wheelAvgMs.toFixed(2)}ms p95=${metrics.wheelP95Ms.toFixed(2)}ms max=${metrics.wheelMaxMs.toFixed(2)}ms`
      );
      rec(
        "PAN-DRAG",
        panSlow ? "AMBER" : "GREEN",
        `burst=${metrics.panBurstMs.toFixed(0)}ms avg=${metrics.panAvgMs.toFixed(2)}ms p95=${metrics.panP95Ms.toFixed(2)}ms max=${metrics.panMaxMs.toFixed(2)}ms`
      );
      rec(
        "LONG-TASKS",
        metrics.longTaskCount > 8 ? "AMBER" : "GREEN",
        `count=${metrics.longTaskCount} total=${metrics.longTaskTotalMs.toFixed(0)}ms`
      );
      report.metrics = metrics;
    }

    await page.screenshot({ path: join(OUT, "vector-after-interaction.png"), fullPage: false });
  } finally {
    await auth.cleanup?.();
    await browser.close();
  }

  writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(`\nReport → ${join(OUT, "report.json")}`);
  const red = report.checks.filter((c) => c.status === "RED").length;
  const amber = report.checks.filter((c) => c.status === "AMBER").length;
  process.exit(red > 0 ? 1 : amber > 0 ? 2 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
