#!/usr/bin/env node
/**
 * Pick which Largo stress bank the nightly workflow runs tonight.
 *
 * `LARGO_STRESS_BANK=all` is 523 live probes at concurrency=1 — structurally ~4+ hours.
 * The nightly job's 45-minute budget cannot finish that scope (measured 2026-08-31: 15/19
 * runs ended `cancelled` at the timeout wall). Rotating one bank per calendar day gives full
 * coverage every four days while each night's run fits comfortably at concurrency 5.
 *
 * Usage:
 *   node scripts/largo-stress-nightly-bank.mjs           # stdout: 1..4 for today (UTC)
 *   node scripts/largo-stress-nightly-bank.mjs --date=2026-09-04
 */
import { pathToFileURL } from "node:url";

const BANK_COUNT = 4;

/**
 * @param {Date} [date]
 * @returns {1|2|3|4}
 */
export function nightlyStressBankForDate(date = new Date()) {
  const utc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const dayOfYear = Math.floor((utc - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86_400_000);
  return ((dayOfYear - 1) % BANK_COUNT) + 1;
}

function parseDateArg() {
  const raw = process.argv.find((a) => a.startsWith("--date="))?.slice("--date=".length);
  if (!raw) return new Date();
  const d = new Date(`${raw}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    console.error(`Invalid --date=${raw} (expected YYYY-MM-DD)`);
    process.exit(2);
  }
  return d;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const bank = nightlyStressBankForDate(parseDateArg());
  process.stdout.write(String(bank));
}
