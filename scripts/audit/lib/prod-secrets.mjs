/**
 * Load production app secrets from AWS Secrets Manager (ECS deploy era).
 * Falls back silently when AWS CLI/creds are unavailable (local dev, CI without AWS).
 */
import { execFileSync } from "node:child_process";

const PROD_SECRET = "blackout-production/app/env";

let cached = null;

function awsRegionArgs() {
  const region = process.env.AWS_DEFAULT_REGION?.trim();
  return region ? ["--region", region] : [];
}

export function loadProdSecretsFromAws() {
  if (cached) return cached;
  try {
    const raw = execFileSync(
      "aws",
      [
        "secretsmanager",
        "get-secret-value",
        "--secret-id",
        PROD_SECRET,
        ...awsRegionArgs(),
        "--query",
        "SecretString",
        "--output",
        "text",
      ],
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
    );
    cached = JSON.parse(raw);
    return cached;
  } catch {
    cached = {};
    return cached;
  }
}

export function prodSecret(key) {
  const fromEnv = process.env[key]?.trim();
  if (fromEnv) return fromEnv;
  const secrets = loadProdSecretsFromAws();
  return secrets[key]?.trim() ?? "";
}

/** Prefer AWS Secrets Manager — cloud-agent env CRON_SECRET is often stale vs prod ECS. */
export function auditSecret(key) {
  const fromAws = loadProdSecretsFromAws()[key]?.trim();
  if (fromAws) return fromAws;
  return process.env[key]?.trim() ?? "";
}
