#!/usr/bin/env node
/**
 * One-shot: post missing Legacy BTO embeds for open outcome rows.
 * Usage: LEGACY_DISCORD_ALERTS=1 ... node --import tsx scripts/backfill-legacy-discord-bto.mjs [edition_for]
 */
import { fetchLegacyDiscordLiveRows, updateLegacyDiscordLiveState } from "../src/lib/db.ts";
import {
  ensureLegacyDiscordBtos,
  legacyInputFromOutcomeRow,
} from "../src/features/nighthawk/lib/legacy-discord-trade-notify.ts";
import { hydrateLegacyLiveSyncRow } from "../src/features/nighthawk/lib/legacy-live-sync.ts";

const editionFor = process.argv[2]?.trim() || null;
const rows = (await fetchLegacyDiscordLiveRows(editionFor ?? undefined)).map(hydrateLegacyLiveSyncRow);
console.log(`[backfill-legacy-discord-bto] open rows: ${rows.length}`);

const result = await ensureLegacyDiscordBtos(
  rows,
  (row) => legacyInputFromOutcomeRow(row),
  (row) =>
    updateLegacyDiscordLiveState(row.id, {
      btoPosted: true,
      mark: row.entry_premium,
      peakPremium: row.peak_premium ?? row.entry_premium,
      troughPremium: row.trough_premium ?? row.entry_premium,
      lastAction: "BTO",
    })
);

console.log(JSON.stringify(result, null, 2));
process.exit(0);
