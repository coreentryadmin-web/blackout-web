import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DESK_SUBMODULES,
  filterSubmodules,
  peelSubmoduleFromArgs,
  resolveSubmodule,
  submoduleDefaultQuestion,
  submodulesForDesk,
} from "./slash-submodules";
import { parseDeskSlashArgs, formatDeskScopeBlock } from "./desk-scope";

describe("submodulesForDesk", () => {
  it("returns SPX Slayer modules", () => {
    const mods = submodulesForDesk("spx-slayer");
    assert.ok(mods.length >= 6);
    assert.ok(mods.some((m) => m.id === "gex"));
    assert.ok(mods.some((m) => m.id === "play"));
  });

  it("covers all product desks", () => {
    for (const desk of [
      "spx-slayer",
      "helix",
      "thermal",
      "vector",
      "nighthawk",
      "meridian",
      "largo",
      "track-record",
    ]) {
      assert.ok(DESK_SUBMODULES[desk as keyof typeof DESK_SUBMODULES]?.length, desk);
    }
  });
});

describe("resolveSubmodule", () => {
  it("resolves alias eod-pin to pin", () => {
    assert.equal(resolveSubmodule("spx-slayer", "eod-pin")?.id, "pin");
  });

  it("resolves helix whales", () => {
    assert.equal(resolveSubmodule("helix", "whales")?.id, "whales");
  });
});

describe("peelSubmoduleFromArgs", () => {
  it("peels submodule and leaves ticker tail", () => {
    const { submodule, rest } = peelSubmoduleFromArgs("helix", "whales NVDA");
    assert.equal(submodule?.id, "whales");
    assert.equal(rest, "NVDA");
  });

  it("peels submodule when token has leading slash", () => {
    const { submodule, rest } = peelSubmoduleFromArgs("spx-slayer", "/gex What's the read?");
    assert.equal(submodule?.id, "gex");
    assert.equal(rest, "What's the read?");
  });
});

describe("parseDeskSlashArgs with desk", () => {
  it("parses /spx-slayer /gex", () => {
    assert.deepEqual(parseDeskSlashArgs("/gex", "spx-slayer"), { submodule: "gex" });
  });

  it("parses /spx-slayer gex", () => {
    assert.deepEqual(parseDeskSlashArgs("gex", "spx-slayer"), { submodule: "gex" });
  });

  it("parses /helix whales NVDA", () => {
    assert.deepEqual(parseDeskSlashArgs("whales NVDA", "helix"), {
      submodule: "whales",
      ticker: "NVDA",
    });
  });

  it("parses gate trace as gates submodule", () => {
    assert.deepEqual(parseDeskSlashArgs("gate trace", "spx-slayer"), {
      submodule: "gates",
      mode: "gate-trace",
    });
  });
});

describe("formatDeskScopeBlock submodule", () => {
  it("includes submodule focus for gex", () => {
    const block = formatDeskScopeBlock("spx-slayer", { submodule: "gex" });
    assert.match(block, /Submodule: GEX matrix/);
    assert.match(block, /get_gex_heatmap/);
  });
});

describe("submoduleDefaultQuestion", () => {
  it("returns play engine question", () => {
    const q = submoduleDefaultQuestion("spx-slayer", "play");
    assert.ok(q?.includes("play engine"));
  });
});

describe("filterSubmodules", () => {
  it("filters by id prefix", () => {
    const all = submodulesForDesk("thermal").map((m) => ({
      id: m.id,
      label: m.label,
      description: m.description,
      rank: m.rank,
      exampleQuestion: m.defaultQuestion("SPX"),
    }));
    const hits = filterSubmodules(all, "vex");
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.id, "vex");
  });
});
