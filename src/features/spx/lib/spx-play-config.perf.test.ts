import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { playClaudeGateEnabled, playMemberReadCacheSec } from "./spx-play-config";

describe("playClaudeGateEnabled", () => {
  it("defaults off when SPX_CLAUDE_GATE unset and not staging", () => {
    delete process.env.SPX_CLAUDE_GATE;
    delete process.env.NEXT_PUBLIC_SITE_URL;
    assert.equal(playClaudeGateEnabled(), false);
  });

  it("explicit SPX_CLAUDE_GATE=1 enables the gate", () => {
    process.env.SPX_CLAUDE_GATE = "1";
    assert.equal(playClaudeGateEnabled(), true);
    delete process.env.SPX_CLAUDE_GATE;
  });

  it("explicit SPX_CLAUDE_GATE=0 disables the gate", () => {
    process.env.SPX_CLAUDE_GATE = "0";
    assert.equal(playClaudeGateEnabled(), false);
    delete process.env.SPX_CLAUDE_GATE;
  });
});

describe("playMemberReadCacheSec", () => {
  it("defaults to 5 seconds for member play read collapse", () => {
    delete process.env.SPX_PLAY_MEMBER_READ_CACHE_SEC;
    assert.equal(playMemberReadCacheSec(), 5);
  });

  it("reads SPX_PLAY_MEMBER_READ_CACHE_SEC override", () => {
    process.env.SPX_PLAY_MEMBER_READ_CACHE_SEC = "5";
    assert.equal(playMemberReadCacheSec(), 5);
    delete process.env.SPX_PLAY_MEMBER_READ_CACHE_SEC;
  });
});
