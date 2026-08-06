import { test } from "node:test";
import assert from "node:assert/strict";
import { runBangerCommit, type BangerCommitDeps } from "./commit.ts";
import type { GroupedDailyRow } from "./discovery.ts";
import type { AggBar } from "@/lib/providers/polygon-largo";

function row(t: string, o: number, h: number, l: number, c: number, v: number): GroupedDailyRow {
  return { T: t, o, h, l, c, v };
}

function fixtureBars(entryClose: number): AggBar[] {
  const entryT = Date.parse("2026-08-04T13:30:00Z");
  return [{ t: entryT, o: entryClose, h: entryClose, l: entryClose, c: entryClose, v: 10 }];
}

test("runBangerCommit is a full no-op when the kill-switch is off", async () => {
  const inserted: unknown[] = [];
  const result = await runBangerCommit({
    fetchGroupedDaily: async () => {
      throw new Error("must not be called when disabled");
    },
    fetchBars: async () => fixtureBars(2),
    insertPosition: async (pos) => {
      inserted.push(pos);
      return 1;
    },
    sessionDate: "2026-08-04",
    env: { BANGER_ENGINE_ENABLED: "0" } as NodeJS.ProcessEnv,
  });
  assert.equal(result.skipped, true);
  assert.equal(result.committed, 0);
  assert.equal(inserted.length, 0);
});

test("runBangerCommit screens, picks a contract, and commits EVERY qualifying ticker (zero caps)", async () => {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const rows: GroupedDailyRow[] = letters
    .flatMap((a) => letters.slice(0, 2).map((b) => `${a}${b}`))
    .slice(0, 30)
    .map((t, i) => row(t, 10, 12, 9.8, 11.9, 1_000_000 + i * 1000));
  const inserted: Array<{ ticker: string }> = [];
  const result = await runBangerCommit({
    fetchGroupedDaily: async () => rows,
    fetchBars: async () => fixtureBars(1.8),
    insertPosition: async (pos) => {
      inserted.push(pos as { ticker: string });
      return inserted.length;
    },
    sessionDate: "2026-08-04",
    env: {} as NodeJS.ProcessEnv,
  });
  assert.equal(result.skipped, false);
  assert.equal(result.screened, 30);
  assert.equal(result.committed, 30, "no top-N cap — every qualifying name gets a commit attempt");
  assert.equal(inserted.length, 30);
});

test("runBangerCommit tallies (not throws on) a contract-probe miss", async () => {
  const rows: GroupedDailyRow[] = [row("NOPE", 10, 12, 9.8, 11.9, 2_000_000)];
  const result = await runBangerCommit({
    fetchGroupedDaily: async () => rows,
    fetchBars: async () => [], // never a usable bar -> pickBangerContract returns null
    insertPosition: async () => 1,
    sessionDate: "2026-08-04",
  });
  assert.equal(result.screened, 1);
  assert.equal(result.contractMisses, 1);
  assert.equal(result.committed, 0);
});

test("runBangerCommit tallies (not throws on) an insert error, keeps scanning the rest", async () => {
  const rows: GroupedDailyRow[] = [
    row("BAD", 10, 12, 9.8, 11.9, 2_000_000),
    row("OK", 10, 12, 9.8, 11.9, 2_100_000),
  ];
  const deps: BangerCommitDeps = {
    fetchGroupedDaily: async () => rows,
    fetchBars: async () => fixtureBars(1.8),
    insertPosition: async (pos) => {
      if (pos.ticker === "BAD") throw new Error("db down");
      return 1;
    },
    sessionDate: "2026-08-04",
  };
  const result = await runBangerCommit(deps);
  assert.equal(result.errors, 1);
  assert.equal(result.committed, 1);
});
