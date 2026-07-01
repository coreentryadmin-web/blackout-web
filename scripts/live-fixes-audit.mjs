#!/usr/bin/env node
/**
 * Multi-round live audit for merged fix bundle (#198/#199/#203/#194 + backfill).
 *
 * Usage:
 *   node scripts/live-fixes-audit.mjs [--rounds=3]
 *
 * Writes audit-output/live-fixes-audit-<stamp>.json
 */
import { execFileSync, execSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import pg from "pg";

const APP = process.env.AUDIT_APP_URL || "https://blackouttrades.com";
const OUT = process.env.AUDIT_OUT || join(process.cwd(), "audit-output");
const ROUNDS = Number(process.argv.find((a) => a.startsWith("--rounds="))?.split("=")[1] ?? 3);
const CJS = "5.57.0";

function req(name) {
  const v = process.env[name];
  const bad = "$" + "{";
  if (!v || v.includes(bad + "{")) {
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
    /* noop */
  }
  return "https://clerk.blackouttrades.com";
}

function railwayVarsJson() {
  try {
    return execSync("railway variables --service blackout-web --json 2>/dev/null", {
      encoding: "utf8",
    });
  } catch {
    return null;
  }
}

async function resolveDbUrl() {
  let url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    try {
      const raw = railwayVarsJson();
      if (raw) {
        const vars = JSON.parse(raw);
        url = vars.DATABASE_PUBLIC_URL || vars.DATABASE_URL;
      }
    } catch {
      /* noop */
    }
  }
  return url || null;
}

const TMP = join(tmpdir(), "live-audit-" + process.pid);
mkdirSync(TMP, { recursive: true });
const JAR = join(TMP, "cookies.txt");
let seq = 0;

function curl(opts) {
  const bf = join(TMP, "b" + ++seq);
  const args = ["-sS", "--max-time", "90", "-o", bf, "-w", "%{http_code}"];
  if (opts.method && opts.method !== "GET") args.push("-X", opts.method);
  for (const [k, v] of Object.entries(opts.headers ?? {}))
    args.push("-H", k + ": " + v);
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

function establishSessions() {
  const SECRET = req("CLERK_SECRET_KEY");
  const CRON = req("CRON_SECRET");
  const PUB = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "";
  const FAPI = fapiHost(PUB);
  const API = "https://api.clerk.com/v1";
  const EMAIL = "live-audit-" + Date.now() + "@blackouttrades.com";
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
  if (!userId) throw new Error("Clerk user create failed");

  const ticket = backend("POST", "/sign_in_tokens", {
    user_id: userId,
    expires_in_seconds: 600,
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
  if (!sid) throw new Error("FAPI sign-in failed");

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
  if (!jwt) throw new Error("JWT mint failed");

  const adminGet = (path) => {
    for (let i = 0; i < 3; i++) {
      jwt = mintJwt() || jwt;
      const res = curl({
        url: APP + path,
        headers: {
          Cookie: "__session=" + jwt + "; __client_uat=" + Math.floor(Date.now() / 1000),
          Accept: "application/json",
          Origin: APP,
          Referer: APP + "/",
        },
      });
      const json = J(res);
      if (res.status === 200 && json) return { status: res.status, json };
      if (res.status === 401 || res.status === 403) continue;
      if (json) return { status: res.status, json };
    }
    return { status: 401, json: null };
  };

  const cronGet = (path) => {
    const res = curl({
      url: APP + path,
      headers: { Authorization: "Bearer " + CRON, Accept: "application/json" },
    });
    return { status: res.status, json: J(res) };
  };

  const cleanup = () => {
    try {
      execFileSync(
        "curl",
        ["-sS", "-X", "DELETE", "-H", "Authorization: Bearer " + SECRET, API + "/users/" + userId],
        { encoding: "utf8" }
      );
    } catch {
      /* noop */
    }
  };

  return { adminGet, cronGet, cleanup, remint: mintJwt };
}

function analyzeHeatmap(hm, ticker) {
  if (!hm?.available || !(hm.spot > 0))
    return { ok: false, ticker, error: "unavailable", httpHint: hm?.error };
  const spot = hm.spot;
  const strikes = hm.strikes ?? [];
  if (!strikes.length) return { ok: false, ticker, error: "no strikes" };
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

  let total = 0;
  let zeros = 0;
  for (const s of strikes) {
    for (const e of expiries) {
      total++;
      const v = cells[String(s)]?.[e];
      if (v == null || v === 0) zeros++;
    }
  }

  const cv = hm.cross_validation;
  const hasCrossVal = cv != null && typeof cv === "object";
  const bandOk = bandPct >= 5.5;
  const farOk = farStats.length === 0 || farStats.every((f) => f.nonZero >= 20);

  return {
    ok: bandOk && farOk,
    ticker,
    spot: Number(spot.toFixed(2)),
    strikeCount: strikes.length,
    expiryCount: expiries.length,
    bandMaxPct: Number(bandPct.toFixed(2)),
    bandOk,
    farStats,
    farOk,
    zeroPct: total ? Number(((zeros / total) * 100).toFixed(1)) : null,
    cross_validation: hasCrossVal
      ? {
          callWallMatch: cv.callWallMatch,
          putWallMatch: cv.putWallMatch,
          flipMatch: cv.flipMatch,
          divergence: cv.divergence,
        }
      : null,
    hasVexShift: Boolean(hm.vex_shift?.delta_by_strike || hm.gex?.shift),
    flip: hm.gex?.flip ?? null,
    call_wall: hm.gex?.call_wall ?? null,
    put_wall: hm.gex?.put_wall ?? null,
  };
}

function unwrapDesk(payload, key) {
  if (!payload) return null;
  if (key && payload[key]) return payload[key];
  return payload;
}

/** #203: same loadSpxDesk() cache lane — rapid /desk repeats must agree (not desk vs merged). */
function checkDeskCacheCoherence(deskRawA, deskRawB, mergedRaw, playRaw) {
  const deskA = unwrapDesk(deskRawA);
  const deskB = unwrapDesk(deskRawB);
  const merged = unwrapDesk(mergedRaw, "merged");
  const play = unwrapDesk(playRaw);
  const issues = [];

  const flipA = deskA?.gamma_flip;
  const flipB = deskB?.gamma_flip;
  if (flipA == null) issues.push("desk missing flip");
  if (flipB == null) issues.push("desk repeat missing flip");
  if (flipA != null && flipB != null && Math.abs(flipA - flipB) > 0.5) {
    issues.push("flip desk repeat drift: " + flipA + " vs " + flipB);
  }

  const mergedFlip = merged?.gamma_flip;
  if (mergedFlip == null) issues.push("merged missing flip");
  // Merged may use flow-lane gamma_flip (~4s) while /desk is base desk (~10s) — informational only.
  const deskVsMergedDelta =
    flipA != null && mergedFlip != null ? Math.abs(flipA - mergedFlip) : null;

  const deskTide =
    deskA?.market_tide?.direction ?? deskA?.tide?.direction ?? deskA?.flow_tide;
  const mergedTide =
    merged?.market_tide?.direction ?? merged?.tide?.direction ?? merged?.flow_tide;
  if (deskTide && mergedTide && deskTide !== mergedTide) {
    issues.push("tide desk vs merged: " + deskTide + " vs " + mergedTide);
  }

  const playDir = play?.direction ?? play?.play?.direction ?? null;
  const deskRegime = deskA?.gamma_regime ?? merged?.gamma_regime;
  if (playDir && deskRegime) {
    const longPlay = String(playDir).toUpperCase() === "LONG";
    const shortPlay = String(playDir).toUpperCase() === "SHORT";
    if (longPlay && /bear|short|fade/i.test(String(deskRegime))) {
      issues.push("play LONG vs regime " + deskRegime);
    }
    if (shortPlay && /bull|long|break/i.test(String(deskRegime))) {
      issues.push("play SHORT vs regime " + deskRegime);
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    deskFlip: flipA,
    deskFlipRepeat: flipB,
    mergedFlip,
    deskVsMergedDelta,
    deskTide,
    mergedTide,
    playDir,
    playAvailable: play?.available,
  };
}

async function dbTrackStats() {
  const url = await resolveDbUrl();
  if (!url) return { ok: false, error: "no db url" };
  const client = new pg.Client({
    connectionString: url,
    ssl: url.includes("rlwy.net") || url.includes("localhost") ? false : { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const { rows } = await client.query(`
      SELECT outcome, exit_action, pnl_pts::float AS pnl
      FROM spx_play_outcomes WHERE outcome <> 'open'
      ORDER BY closed_at DESC
    `);
    const wins = rows.filter((r) => r.outcome === "win").length;
    const losses = rows.filter((r) => r.outcome === "loss").length;
    const total = rows.length;
    const misgraded = rows.filter(
      (r) =>
        r.exit_action === "THESIS" &&
        r.outcome === "loss" &&
        r.pnl != null &&
        Number(r.pnl) > 0
    );
    return {
      ok: wins >= 2 && misgraded.length === 0,
      wins,
      losses,
      total,
      winRatePct: total ? Math.round((wins / total) * 1000) / 10 : null,
      misgradedThesis: misgraded.length,
    };
  } finally {
    await client.end();
  }
}

async function runRound(round, sessions) {
  const { adminGet, cronGet, remint } = sessions;
  if (remint) {
    try {
      const t = remint();
      if (t) sessions._jwt = t;
    } catch {
      /* session may still work */
    }
  }
  const checks = [];

  const pubTr = curl({
    url: APP + "/api/public/track-record",
    headers: { Accept: "application/json" },
  });
  const pubJson = J(pubTr);
  checks.push({
    name: "public-track-record-gated",
    ok: pubTr.status === 401 || pubTr.status === 403,
    status: pubTr.status,
    error: pubJson?.error,
    fix: "#184 admin-only (expected 401/403)",
  });

  let tr = adminGet("/api/track-record");
  const spx = tr.json?.spxSlayer;
  checks.push({
    name: "track-record-admin",
    ok:
      tr.status === 200 &&
      tr.json?.liveData &&
      spx?.total >= 9 &&
      spx?.wins >= 2 &&
      spx?.winRatePct >= 20,
    status: tr.status,
    spx,
    fix: "#194 + backfill",
  });

  const db = await dbTrackStats();
  checks.push({ name: "track-record-db", fix: "backfill", ...db });

  for (const ticker of ["QQQ", "SPX", "SPY"]) {
    const hm = cronGet("/api/market/gex-heatmap?ticker=" + ticker + "&force=1");
    const analysis = analyzeHeatmap(hm.json, ticker);
    checks.push({
      name: "heatmap-" + ticker,
      http: hm.status,
      fix: "#198 band+far-dated+cross-val",
      ...analysis,
    });
  }

  const pos = cronGet("/api/market/gex-positioning?ticker=SPX");
  checks.push({
    name: "gex-positioning-spx",
    ok: pos.status === 200 && pos.json?.available !== false && (pos.json?.spot ?? 0) > 0,
    status: pos.status,
    hasCrossVal: Boolean(pos.json?.gex_cross_validation),
    flip: pos.json?.flip,
    fix: "#198 positioning fallback + cross-val",
  });

  const desk = cronGet("/api/market/spx/desk");
  const desk2 = cronGet("/api/market/spx/desk");
  const merged = cronGet("/api/market/spx/merged");
  const play = cronGet("/api/market/spx/play");
  const coherence = checkDeskCacheCoherence(desk.json, desk2.json, merged.json, play.json);
  checks.push({
    name: "spx-desk-cache-coherence",
    fix: "#203 loadSpxDesk() single cache lane",
    deskStatus: desk.status,
    mergedStatus: merged.status,
    playStatus: play.status,
    ...coherence,
  });

  return {
    round,
    at: new Date().toISOString(),
    pass: checks.filter((c) => c.ok).length,
    fail: checks.filter((c) => c.ok === false).length,
    check: checks.filter((c) => c.ok === undefined && c.error).length,
    checks,
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  console.log("\n=== Live fixes audit — " + ROUNDS + " rounds ===\n");

  // Preload DB URL for all rounds (Railway project token — unset account token if invalid)
  if (!process.env.DATABASE_URL && !process.env.DATABASE_PUBLIC_URL) {
    try {
      const raw = railwayVarsJson();
      if (raw) {
        const vars = JSON.parse(raw);
        process.env.DATABASE_PUBLIC_URL =
          process.env.DATABASE_PUBLIC_URL || vars.DATABASE_PUBLIC_URL;
        process.env.DATABASE_URL = process.env.DATABASE_URL || vars.DATABASE_URL;
      }
    } catch {
      /* optional */
    }
  }

  const rounds = [];

  try {
    for (let r = 1; r <= ROUNDS; r++) {
      console.log("--- Round " + r + "/" + ROUNDS + " ---");
      const sessions = establishSessions();
      let result;
      try {
        result = await runRound(r, sessions);
      } finally {
        sessions.cleanup();
      }
      rounds.push(result);
      for (const c of result.checks) {
        const mark = c.ok ? "PASS" : c.ok === false ? "FAIL" : "INFO";
        console.log("  [" + mark + "] " + c.name + (c.detail ? " — " + c.detail : ""));
        if (c.ok === false && c.issues) console.log("         " + c.issues.join("; "));
        if (c.ok === false && c.error) console.log("         " + c.error);
        if (c.spx) console.log("         SPX " + c.spx.wins + "W/" + c.spx.losses + "L → " + c.spx.winRatePct + "%");
        if (c.bandMaxPct != null)
          console.log(
            "         " +
              (c.ticker || "") +
              " spot=" +
              c.spot +
              " band~" +
              c.bandMaxPct +
              "% strikes=" +
              c.strikeCount
          );
      }
      console.log(
        "  Round summary: " + result.pass + " pass / " + result.fail + " fail\n"
      );
      if (r < ROUNDS) await sleep(4000);
    }
  } catch (e) {
    console.error(e);
    throw e;
  }

  const deploy = spawnSync("node", ["scripts/validate-deploy.mjs"], {
    encoding: "utf8",
    env: process.env,
  });
  const deployOk = deploy.status === 0;

  const allChecks = rounds.flatMap((r) => r.checks.map((c) => ({ ...c, round: r.round })));
  const failNames = [...new Set(allChecks.filter((c) => c.ok === false).map((c) => c.name))];

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const report = {
    generated_at: new Date().toISOString(),
    app: APP,
    rounds: ROUNDS,
    deployOk,
    summary: {
      totalChecks: allChecks.length,
      pass: allChecks.filter((c) => c.ok).length,
      fail: allChecks.filter((c) => c.ok === false).length,
      flakyFails: failNames,
    },
    rounds,
  };

  const outPath = join(OUT, "live-fixes-audit-" + stamp + ".json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log("=== FINAL ===");
  console.log("Deploy validate: " + (deployOk ? "GREEN" : "RED"));
  console.log(
    "Checks: " +
      report.summary.pass +
      " pass / " +
      report.summary.fail +
      " fail across " +
      ROUNDS +
      " rounds"
  );
  if (failNames.length) console.log("Failed (any round): " + failNames.join(", "));
  console.log("Report: " + outPath + "\n");

  process.exit(report.summary.fail > 0 || !deployOk ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
