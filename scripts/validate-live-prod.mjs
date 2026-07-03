#!/usr/bin/env node
/**
 * Live production validation (admin-authenticated):
 *   - GET /api/track-record
 *   - GET /api/market/gex-heatmap?ticker=QQQ&force=1
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const APP = process.env.AUDIT_APP_URL || "https://blackouttrades.com";
const OUT = process.env.AUDIT_OUT || join(process.cwd(), "audit-output");
const CJS = "5.57.0";

function req(name) {
  const v = process.env[name];
  const badPlaceholder = "$" + "{";
  if (!v || v.includes(badPlaceholder + "{")) {
    console.error("FATAL: " + name + " missing");
    process.exit(2);
  }
  return v;
}

function fapiHost(pub) {
  try {
    const d = Buffer.from(pub.replace(/^pk_(live|test)_/, ""), "base64")
      .toString("utf8")
      .replace(/\$$/, "");
    if (d.includes(".")) return "https://" + d;
  } catch {
    /* fall through */
  }
  return "https://clerk.blackouttrades.com";
}

const TMP = join(tmpdir(), "bo-live-" + process.pid);
mkdirSync(TMP, { recursive: true });
const JAR = join(TMP, "cookies.txt");
let seq = 0;

function curl(opts) {
  const bf = join(TMP, "b" + ++seq);
  const args = ["-sS", "--max-time", "60", "-o", bf, "-w", "%{http_code}"];
  if (opts.method && opts.method !== "GET") args.push("-X", opts.method);
  for (const [k, v] of Object.entries(opts.headers ?? {})) args.push("-H", k + ": " + v);
  if (opts.json)
    args.push("-H", "Content-Type: application/json", "--data", JSON.stringify(opts.json));
  if (opts.urlencodeForm)
    for (const [k, v] of Object.entries(opts.urlencodeForm))
      args.push("--data-urlencode", k + "=" + v);
  if (opts.jar) args.push("-b", JAR);
  if (opts.saveJar) args.push("-c", JAR);
  args.push(opts.url);
  const status = Number(execFileSync("curl", args, { encoding: "utf8" }).trim());
  let body = "";
  try {
    body = execFileSync("cat", [bf], { encoding: "utf8" });
  } catch {
    body = "";
  }
  return { status, body };
}

const J = (r) => {
  try {
    return JSON.parse(r.body);
  } catch {
    return null;
  }
};

function establishAdminSession() {
  const SECRET = req("CLERK_SECRET_KEY");
  const PUB = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "";
  const FAPI = fapiHost(PUB);
  const API = "https://api.clerk.com/v1";
  const EMAIL = "live-validate-" + Date.now() + "@blackouttrades.com";
  const PHONE = "+1415555" + String(1000 + (Date.now() % 9000));

  const backend = (method, path, json) =>
    J(
      curl({
        method,
        url: API + path,
        headers: { Authorization: "Bearer " + SECRET },
        json,
      })
    );

  const created = backend("POST", "/users", {
    email_address: [EMAIL],
    phone_number: [PHONE],
    public_metadata: { role: "admin", tier: "premium" },
    skip_password_requirement: true,
    skip_legal_checks: true,
  });
  const userId = created?.id;
  if (!userId) {
    throw new Error("Clerk user create failed: " + JSON.stringify(created).slice(0, 200));
  }

  const ticket = backend("POST", "/sign_in_tokens", {
    user_id: userId,
    expires_in_seconds: 300,
  })?.token;
  if (!ticket) throw new Error("sign_in_token missing");

  const si = curl({
    method: "POST",
    url: FAPI + "/v1/client/sign_ins?_clerk_js_version=" + CJS,
    headers: {
      Origin: APP,
      Referer: APP + "/",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    urlencodeForm: { strategy: "ticket", ticket },
    saveJar: true,
    jar: true,
  });
  const sid = J(si)?.response?.created_session_id;
  if (!sid) throw new Error("FAPI sign-in failed: " + si.body.slice(0, 200));

  const mintJwt = () =>
    J(
      curl({
        method: "POST",
        url: FAPI + "/v1/client/sessions/" + sid + "/tokens?_clerk_js_version=" + CJS,
        headers: {
          Origin: APP,
          Referer: APP + "/",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        jar: true,
        saveJar: true,
      })
    )?.jwt;

  let jwt = mintJwt();
  if (!jwt) throw new Error("session JWT mint failed");

  const appGet = (path, opts) => {
    for (let i = 0; i < 2; i++) {
      const headers = {
        Accept: "application/json",
      };
      if (opts?.cron) {
        headers.Authorization = "Bearer " + req("CRON_SECRET");
      } else {
        headers.Cookie = "__session=" + jwt + "; __client_uat=" + Math.floor(Date.now() / 1000);
      }
      const res = curl({ url: APP + path, headers });
      const json = J(res);
      if (json) return { status: res.status, json };
      if (!opts?.cron) jwt = mintJwt();
    }
    return { status: 0, json: null };
  };

  const cleanup = () => {
    try {
      execFileSync(
        "curl",
        ["-sS", "-X", "DELETE", "-H", "Authorization: Bearer " + SECRET, API + "/users/" + userId],
        { encoding: "utf8" }
      );
    } catch {
      /* best effort */
    }
  };

  return { appGet, cleanup };
}

function analyzeQqq(hm) {
  if (!hm?.available || !(hm.spot > 0))
    return { ok: false, error: "QQQ heatmap unavailable", raw: hm };
  const spot = hm.spot;
  const strikes = hm.strikes ?? [];
  const minS = Math.min(...strikes);
  const maxS = Math.max(...strikes);
  const bandPct = Math.max((spot - minS) / spot, (maxS - spot) / spot) * 100;
  const cells = hm.gex?.cells ?? {};
  const expiries = hm.expiries ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const far = expiries.filter((e) => e > today).slice(-6);
  const farStats = far.map((exp) => {
    let nz = 0;
    for (const s of strikes) {
      const v = cells[String(s)]?.[exp];
      if (v && v !== 0) nz++;
    }
    return { exp, nonZero: nz, axis: strikes.length };
  });
  return {
    ok: bandPct >= 5 && farStats.every((f) => f.nonZero >= 20 || f.axis < 30),
    spot,
    strikeCount: strikes.length,
    bandMaxPct: Number(bandPct.toFixed(2)),
    expiryCount: expiries.length,
    farStats,
  };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const report = { at: new Date().toISOString(), checks: [] };
  const { appGet, cleanup } = establishAdminSession();

  try {
    console.log("\n=== Live production validation ===\n");

    const tr = appGet("/api/track-record");
    const spx = tr.json?.spxSlayer;
    const trackOk =
      tr.status === 200 &&
      tr.json?.liveData &&
      spx &&
      spx.total >= 9 &&
      spx.wins >= 2 &&
      spx.winRatePct >= 20;
    report.checks.push({ name: "track-record", ok: trackOk, status: tr.status, spx });
    console.log("Track record:");
    console.log(
      "  HTTP " +
        tr.status +
        " — " +
        spx?.wins +
        "W / " +
        spx?.losses +
        "L / " +
        spx?.total +
        " → " +
        spx?.winRatePct +
        "%"
    );
    console.log("  " + (trackOk ? "PASS" : "CHECK"));

    const q = appGet("/api/market/gex-heatmap?ticker=QQQ&force=1", { cron: true });
    const analysis = analyzeQqq(q.json);
    report.checks.push({ name: "qqq-heatmap", httpStatus: q.status, ...analysis });
    console.log("\nQQQ heatmap:");
    if (analysis.error) console.log("  FAIL — " + analysis.error + " (HTTP " + q.status + ")");
    else {
      console.log(
        "  spot=" +
          analysis.spot +
          " strikes=" +
          analysis.strikeCount +
          " band~" +
          analysis.bandMaxPct +
          "%"
      );
      for (const f of analysis.farStats ?? []) {
        console.log("  far " + f.exp + ": " + f.nonZero + "/" + f.axis + " non-zero");
      }
      console.log("  " + (analysis.ok ? "PASS" : "CHECK"));
    }
  } finally {
    cleanup();
  }

  const outPath = join(OUT, "live-prod-validation.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log("\nReport: " + outPath + "\n");
  process.exit(report.checks.every((c) => c.ok) ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
