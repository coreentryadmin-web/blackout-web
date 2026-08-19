import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  filterLargoSlashCommands,
  largoSlashQueryFromInput,
  parseLargoSlashInput,
  resolveLargoSlashSubmit,
  resolveSlashNavigateHref,
} from "./slash-commands";

describe("largoSlashQueryFromInput", () => {
  it("returns null when not in slash mode", () => {
    assert.equal(largoSlashQueryFromInput("hello"), null);
    assert.equal(largoSlashQueryFromInput(""), null);
  });

  it("returns filter token while typing first word", () => {
    assert.equal(largoSlashQueryFromInput("/hel"), "hel");
    assert.equal(largoSlashQueryFromInput("  /thermal"), "thermal");
  });

  it("returns null after first token (args mode)", () => {
    assert.equal(largoSlashQueryFromInput("/helix NVDA"), null);
  });
});

describe("filterLargoSlashCommands", () => {
  it("lists all commands sorted by rank when query empty", () => {
    const all = filterLargoSlashCommands("", 20);
    assert.ok(all.length >= 7);
    assert.equal(all[0]?.command, "spx-slayer");
  });

  it("prefix-filters helix aliases", () => {
    const hits = filterLargoSlashCommands("hel");
    assert.ok(hits.some((h) => h.command === "helix"));
  });

  it("matches thermal alias gex", () => {
    const hits = filterLargoSlashCommands("gex");
    assert.ok(hits.some((h) => h.command === "thermal"));
  });
});

describe("parseLargoSlashInput", () => {
  it("parses command and ticker args", () => {
    const { command, args } = parseLargoSlashInput("/helix NVDA");
    assert.equal(command?.command, "helix");
    assert.equal(args, "NVDA");
  });
});

describe("resolveSlashNavigateHref", () => {
  it("appends ticker query param for flow desk", () => {
    assert.equal(resolveSlashNavigateHref({ href: "/flows" } as never, "NVDA"), "/flows?ticker=NVDA");
  });
});

describe("resolveLargoSlashSubmit", () => {
  it("navigates on bare desk command", () => {
    assert.deepEqual(resolveLargoSlashSubmit("/helix"), {
      type: "navigate",
      href: "/flows",
    });
  });

  it("navigates with ticker arg", () => {
    assert.deepEqual(resolveLargoSlashSubmit("/thermal SPY"), {
      type: "navigate",
      href: "/heatmap?ticker=SPY",
    });
  });

  it("runs prompt question for desk prompts", () => {
    const out = resolveLargoSlashSubmit("/spx-setup");
    assert.equal(out.type, "query");
    if (out.type === "query") {
      assert.match(out.question, /SPX setup/i);
    }
  });

  it("passes through non-slash text", () => {
    assert.deepEqual(resolveLargoSlashSubmit("What is SPX doing?"), {
      type: "plain",
      text: "What is SPX doing?",
    });
  });
});
