import { buildEveningEdition } from "@/lib/nighthawk/edition-builder";
import { ensureSchema } from "@/lib/db";
import { logCronRun } from "@/lib/cron-run";

async function main() {
  const started = Date.now();
  await ensureSchema();
  const force = process.argv.includes("--force");
  try {
    const result = await buildEveningEdition({ force });
    console.log("[nighthawk-worker] result:", JSON.stringify(result, null, 2));
    await logCronRun("nighthawk-playbook", started, {
      ok: result.ok,
      ...result,
      error: result.error,
    });
    process.exit(result.ok ? 0 : 1);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await logCronRun("nighthawk-playbook", started, { ok: false, error: message });
    throw e;
  }
}

main().catch((e) => {
  console.error("[nighthawk-worker] fatal:", e);
  process.exit(1);
});
