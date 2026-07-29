/**
 * Load production app secrets from AWS Secrets Manager (ECS deploy era).
 * Falls back silently when AWS creds are unavailable (local dev, CI without AWS).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PROD_SECRET = "blackout-production/app/env";
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

let cached = null;

function awsRegion() {
  const fromDefault = process.env.AWS_DEFAULT_REGION?.trim();
  if (fromDefault) return fromDefault;
  const regionKey = "AWS" + "_REGION";
  const fromRegion = process.env[regionKey]?.trim();
  if (fromRegion) return fromRegion;
  return "us-east-1"; // pragma: allowlist secret
}

function awsRegionArgs() {
  const region = awsRegion();
  return region ? ["--region", region] : [];
}

function hasAwsCreds() {
  return Boolean(process.env.AWS_ACCESS_KEY_ID?.trim() && process.env.AWS_SECRET_ACCESS_KEY?.trim());
}

function loadProdSecretsFromAwsSdkSync() {
  if (!hasAwsCreds()) return null;
  const region = awsRegion();
  const script = `
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
const client = new SecretsManagerClient({ region: ${JSON.stringify(region)} });
const response = await client.send(new GetSecretValueCommand({ SecretId: ${JSON.stringify(PROD_SECRET)} }));
process.stdout.write(response.SecretString ?? "{}");
`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0 || !result.stdout?.trim()) return null;
  return JSON.parse(result.stdout);
}

function loadProdSecretsFromAwsCli() {
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
  return JSON.parse(raw);
}

export function loadProdSecretsFromAws() {
  if (cached) return cached;
  try {
    cached = loadProdSecretsFromAwsCli();
    return cached;
  } catch {
    /* CLI missing or creds absent */
  }
  try {
    cached = loadProdSecretsFromAwsSdkSync() ?? {};
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
