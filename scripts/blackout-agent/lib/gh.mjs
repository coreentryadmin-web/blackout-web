import { spawnSync } from "node:child_process";

/**
 * gh subprocess env. Cloud Agent VMs often inject a stale GH_TOKEN that shadows the
 * working credentials in ~/.config/gh/hosts.yml — pr-sweep then returns [] open PRs.
 * GitHub Actions uses GITHUB_TOKEN instead; only strip GH_TOKEN outside Actions.
 */
export function ghEnv() {
  const env = { ...process.env };
  if (!process.env.GITHUB_ACTIONS) {
    delete env.GH_TOKEN;
  }
  return env;
}

export function ghSpawn(args, opts = {}) {
  return spawnSync("gh", args, { encoding: "utf8", ...opts, env: ghEnv() });
}
