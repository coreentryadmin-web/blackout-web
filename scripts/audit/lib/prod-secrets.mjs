/**
 * Load production app secrets from AWS Secrets Manager (ECS deploy era).
 * Falls back silently when AWS CLI/creds are unavailable (local dev, CI without AWS).
 */
import { execFileSync } from "node:child_process";

const PROD_SECRET = "blackout-production/app/env";

let cached = null;

function awsRegion() {
  // pragma: allowlist secret
  return process.env.AWS_DEFAULT_REGION?.trim() || process.env["AWS_REGION"]?.trim() || "";
}

function awsRegionArgs() {
  const region = awsRegion();
  return region ? ["--region", region] : [];
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

/** SDK fallback when aws CLI is missing (common on Cloud Agent pods). */
function loadProdSecretsFromAwsSdk() {
  const region = awsRegion();
  const regionArg = region ? `new SecretsManagerClient({ region: ${JSON.stringify(region)} })` : "new SecretsManagerClient({})";
  const raw = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
const client = ${regionArg};
const out = await client.send(new GetSecretValueCommand({ SecretId: ${JSON.stringify(PROD_SECRET)} }));
process.stdout.write(out.SecretString ?? "{}");`,
    ],
    { encoding: "utf8", env: process.env, stdio: ["pipe", "pipe", "pipe"] }
  );
  return JSON.parse(raw);
}

export function loadProdSecretsFromAws() {
  if (cached) return cached;
  for (const loader of [loadProdSecretsFromAwsCli, loadProdSecretsFromAwsSdk]) {
    try {
      cached = loader();
      return cached;
    } catch {
      /* try next loader */
    }
  }
  cached = {};
  return cached;
}

export function prodSecret(key) {
  const fromEnv = process.env[key]?.trim();
  if (fromEnv) return fromEnv;
  const secrets = loadProdSecretsFromAws();
  return secrets[key]?.trim() ?? "";
}

/** Prefer AWS Secrets Manager — cloud-agent/GitHub env secrets are often stale vs prod ECS. */
export function auditSecret(key) {
  const fromAws = loadProdSecretsFromAws()[key]?.trim();
  if (fromAws) return fromAws;
  return process.env[key]?.trim() ?? "";
}
