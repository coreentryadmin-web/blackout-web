#!/usr/bin/env node
/**
 * Full admin validation — user-management API + admin console UI.
 * Starts from keyless localhost dev (see AGENTS.md).
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { waitForServer } from "./audit/lib/admin-e2e-helpers.mjs";

const BASE = (process.env.ADMIN_E2E_BASE ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const MANAGE_DEV = process.env.ADMIN_E2E_MANAGE_DEV !== "0";

async function runNode(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      stdio: "inherit",
      env: { ...process.env, ADMIN_E2E_BASE: BASE },
      cwd: join(process.cwd()),
    });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${script} exit ${code}`))));
    child.on("error", reject);
  });
}

async function ensureKeylessDev() {
  if (!MANAGE_DEV) {
    if (await waitForServer(BASE, 5_000)) return null;
    throw new Error("ADMIN_E2E_MANAGE_DEV=0 but dev server not running");
  }

  if (await waitForServer(BASE, 3_000)) {
    console.log("Dev server already up.");
    return null;
  }

  const keylessPath = join(process.cwd(), ".clerk/.tmp/keyless.json");
  console.log("Starting keyless dev server…");
  const child = spawn("npm", ["run", "dev"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      CLERK_SECRET_KEY: "",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "",
      PORT: "3000",
    },
    cwd: process.cwd(),
    detached: false,
  });

  child.stdout?.on("data", (d) => process.stdout.write(d));
  child.stderr?.on("data", (d) => process.stderr.write(d));

  const ready = await waitForServer(BASE, 180_000);
  if (!ready) {
    child.kill("SIGTERM");
    throw new Error("Dev server failed to become ready");
  }

  // Give keyless Clerk a moment to write keyless.json
  for (let i = 0; i < 20 && !existsSync(keylessPath); i++) {
    await new Promise((r) => setTimeout(r, 500));
  }

  return child;
}

async function main() {
  console.log("=== Admin full E2E validation ===\n");
  let dev = null;
  try {
    dev = await ensureKeylessDev();
    console.log("\n--- User management API ---\n");
    await runNode("scripts/validate-admin-users-e2e.mjs");
    console.log("\n--- Admin console UI ---\n");
    await runNode("scripts/validate-admin-console-e2e.mjs");
    console.log("\nPASS: admin full E2E");
  } finally {
    if (dev) {
      dev.kill("SIGTERM");
      console.log("Stopped dev server.");
    }
  }
}

main().catch((e) => {
  console.error("FAIL:", e.message ?? e);
  process.exit(1);
});
