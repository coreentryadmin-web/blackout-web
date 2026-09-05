import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";

describe("ai-env", () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
  });

  afterEach(() => {
    process.env = env;
  });

  it("largoClaudeEnabled on prod when Anthropic key present", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://blackouttrades.com";
    process.env.ANTHROPIC_API_KEY = "sk-test";
    const { largoClaudeEnabled, largoAvailable, isStagingBieMode } = await import("@/lib/ai-env");
    assert.equal(isStagingBieMode(), false);
    assert.equal(largoClaudeEnabled(), true);
    assert.equal(largoAvailable(), true);
  });

  it("staging requires STAGING_LARGO_CLAUDE for Largo", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://staging.blackouttrades.com";
    process.env.ANTHROPIC_API_KEY = "sk-test";
    const { largoClaudeEnabled, claudeEnabled } = await import("@/lib/ai-env");
    assert.equal(claudeEnabled(), false);
    assert.equal(largoClaudeEnabled(), false);
    process.env.STAGING_LARGO_CLAUDE = "1";
    const mod = await import("@/lib/ai-env");
    assert.equal(mod.largoClaudeEnabled(), true);
  });
});
