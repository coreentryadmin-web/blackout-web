import assert from "node:assert/strict";
import { test } from "node:test";
import { thermalDiscordRthOnly } from "./thermal-discord-rth";

test("thermalDiscordRthOnly defaults to true (RTH-only posts)", () => {
  const prev = process.env.THERMAL_DISCORD_RTH_ONLY;
  delete process.env.THERMAL_DISCORD_RTH_ONLY;
  try {
    assert.equal(thermalDiscordRthOnly(), true);
  } finally {
    if (prev === undefined) delete process.env.THERMAL_DISCORD_RTH_ONLY;
    else process.env.THERMAL_DISCORD_RTH_ONLY = prev;
  }
});

test("thermalDiscordRthOnly: 0 opts out to 24/7", () => {
  const prev = process.env.THERMAL_DISCORD_RTH_ONLY;
  process.env.THERMAL_DISCORD_RTH_ONLY = "0";
  try {
    assert.equal(thermalDiscordRthOnly(), false);
  } finally {
    if (prev === undefined) delete process.env.THERMAL_DISCORD_RTH_ONLY;
    else process.env.THERMAL_DISCORD_RTH_ONLY = prev;
  }
});
