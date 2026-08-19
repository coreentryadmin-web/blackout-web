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
  const helixPrompts = [
    {
      id: "helix-leader",
      label: "NVDA tape leader",
      question: "Summarize HELIX flow on NVDA — biggest prints and net premium.",
      rank: 10,
    },
  ];

  it("asks dynamic question on bare desk command", () => {
    const out = resolveLargoSlashSubmit("/helix", helixPrompts);
    assert.equal(out.type, "query");
    if (out.type === "query") {
      assert.match(out.question, /NVDA/i);
    }
  });

  it("asks scoped question for ticker arg", () => {
    const out = resolveLargoSlashSubmit("/thermal SPY");
    assert.equal(out.type, "query");
    if (out.type === "query") {
      assert.match(out.question, /SPY/i);
    }
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
