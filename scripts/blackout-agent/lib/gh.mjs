import { spawnSync } from "node:child_process";

/** Cloud Agent env often sets an invalid GH_TOKEN that overrides gh hosts.yml auth. */
export function ghEnv() {
  const env = { ...process.env };
  delete env.GH_TOKEN;
  return env;
}

export function ghJson(args) {
  const r = spawnSync("gh", args, { encoding: "utf8", env: ghEnv() });
  if (r.status !== 0) return null;
  try {
    return JSON.parse(r.stdout || "null");
  } catch {
    return null;
  }
}

export function ghRun(args) {
  const r = spawnSync("gh", args, { encoding: "utf8", env: ghEnv() });
  return { ok: r.status === 0, stdout: r.stdout, stderr: r.stderr, status: r.status };
}
