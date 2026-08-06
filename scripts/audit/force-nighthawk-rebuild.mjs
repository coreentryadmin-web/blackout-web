#!/usr/bin/env node
/** One-shot admin force-rebuild + poll edition + debrief. Deletes temp Clerk user. */
import { execSync } from "node:child_process";
import { unlinkSync } from "node:fs";
import { setTimeout as sleepMs } from "node:timers/promises";
import { createOrAdoptAuditUser } from "./lib/clerk-audit-user.mjs";

const APP = process.env.VALIDATE_BASE || "https://blackouttrades.com";
const API = "https://api.clerk.com/v1";
const FAPI = "https://clerk.blackouttrades.com";
const CJS = "5.57.0";
const SECRET = process.env.CLERK_SECRET_KEY;
const JAR = `/tmp/nh-force-${Date.now()}.jar`;

function J(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function sh(cmd) {
  return execSync(cmd, { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
}

async function auth() {
  const EMAIL = `audit-nh-force-${Date.now()}@blackouttrades.com`;
  // No adoptByEmail callback (the e-mail is per-run unique); the shared helper is here so a
  // collision on the random +1415555XXXX phone redraws instead of aborting the rebuild.
  const created = await createOrAdoptAuditUser({
    createUser: (phone) =>
      J(
        sh(
          `curl -sS -X POST -H "Authorization: Bearer ${SECRET}" -H "Content-Type: application/json" -d '${JSON.stringify(
            {
              email_address: [EMAIL],
              phone_number: [phone],
              public_metadata: { role: "admin", tier: "premium" },
              skip_password_requirement: true,
              skip_legal_checks: true,
            }
          )}' "${API}/users"`
        )
      ),
  });
  const uid = created.userId;
  if (!uid) throw new Error(`user create failed: ${String(created.error).slice(0, 200)}`);
  const ticket = J(
    sh(
      `curl -sS -X POST -H "Authorization: Bearer ${SECRET}" -H "Content-Type: application/json" -d '{"user_id":"${uid}"}' "${API}/sign_in_tokens"`
    )
  )?.token;
  sh(
    `curl -sS -c "${JAR}" -X POST -H "Origin: ${APP}" --data-urlencode "strategy=ticket" --data-urlencode "ticket=${ticket}" "${FAPI}/v1/client/sign_ins?_clerk_js_version=${CJS}"`
  );
  const sid = J(sh(`curl -sS -b "${JAR}" "${FAPI}/v1/client?_clerk_js_version=${CJS}"`))?.response
    ?.last_active_session_id;
  const clientUat = Math.floor(Date.now() / 1000);
  const tok = J(
    sh(
      `curl -sS -b "${JAR}" -X POST "${FAPI}/v1/client/sessions/${sid}/tokens?_clerk_js_version=${CJS}"`
    )
  )?.jwt;
  return {
    uid,
    fetch: (path, method = "GET", body) => {
      const dataFlag = body ? `-d '${JSON.stringify(body)}'` : "";
      const methodFlag = method === "POST" ? "-X POST" : "";
      const raw = sh(
        `curl -sS -w "\\n%{http_code}" ${methodFlag} -H "Cookie: __session=${tok}; __client_uat=${clientUat}" -H "Content-Type: application/json" -H "Accept: application/json" ${dataFlag} "${APP}${path}"`
      );
      const lines = raw.trimEnd().split("\n");
      const code = Number(lines.pop());
      const text = lines.join("\n");
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* */
      }
      return { code, json, text: text.slice(0, 2000) };
    },
  };
}

async function main() {
  if (!SECRET) {
    console.error("CLERK_SECRET_KEY required");
    process.exit(1);
  }
  const { uid, fetch } = await auth();
  try {
    console.log("=== POST /api/admin/nighthawk/run (force rebuild) ===");
    const run = fetch("/api/admin/nighthawk/run", "POST");
    console.log(JSON.stringify(run, null, 2));

    let lastPublishedAt = null;
    for (let i = 0; i < 40; i++) {
      await sleepMs(15_000);
      const preview = fetch("/api/admin/nighthawk/publish-preview?edition_for=2026-08-03");
      const edition = fetch("/api/market/nighthawk/edition?date=2026-08-03");
      const publishedAt = preview.json?.published_at ?? edition.json?.published_at;
      const rebuilt = publishedAt && publishedAt !== lastPublishedAt;
      if (rebuilt) lastPublishedAt = publishedAt;
      console.log(
        `\n--- poll ${i + 1} --- plays=${edition.json?.plays?.length ?? "?"} job=${preview.json?.job?.status}/${preview.json?.job?.stage} play_count=${preview.json?.play_count} published_at=${publishedAt}${rebuilt ? " (updated)" : ""}`
      );
      if (run.json?.job_status === "published" && i === 0) {
        // fast path if build completed inline
      }
      if (preview.json?.job?.status === "published" && run.code === 200 && i >= 0) {
        const buildDone =
          run.json?.job_status === "published" ||
          (preview.json?.play_count ?? 0) > 0 ||
          (i > 2 && preview.json?.job?.stage === "published");
        if (buildDone && (rebuilt || i >= 2)) {
          console.log("\n=== final edition ===");
          console.log(
            JSON.stringify(
              {
                play_count: preview.json?.play_count,
                plays: preview.json?.plays,
                critic_notes: preview.json?.critic_notes,
                recap_only_reason: edition.json?.recap_only_reason,
                published_at: publishedAt,
              },
              null,
              2
            )
          );
          const debrief = fetch("/api/admin/nighthawk/analytics?window=14");
          console.log("\n=== debrief improvement_queue ===");
          console.log(JSON.stringify(debrief.json?.debrief_report?.improvement_queue?.slice(0, 6), null, 2));
          if (run.json?.job_status === "published" || preview.json?.job?.stage === "published") break;
        }
      }
      if (run.code === 200 && run.json?.job_status === "published") {
        console.log("\n=== inline build complete ===");
        console.log(JSON.stringify(run.json, null, 2));
        break;
      }
    }
  } finally {
    try {
      sh(`curl -sS -X DELETE -H "Authorization: Bearer ${SECRET}" "${API}/users/${uid}"`);
    } catch {
      /* */
    }
    try {
      unlinkSync(JAR);
    } catch {
      /* */
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
