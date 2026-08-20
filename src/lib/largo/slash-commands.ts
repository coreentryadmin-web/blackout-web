/**
 * Largo composer slash commands — desk navigation + first-class prompts.
 * Shown when the member types `/`; filterable and keyboard-selectable.
 */

import { TOOLS, type ToolKey } from "@/lib/tool-access";
import { LARGO_DESK_PROMPTS } from "@/lib/largo/desk-prompts";
import { parseDeskSlashArgs, type DeskSlashArgs, deskScopeConfig } from "@/lib/largo/desk-scope";
import { submoduleDefaultQuestion } from "@/lib/largo/slash-submodules";

export type LargoSlashCommandKind = "navigate" | "prompt";

export type LargoSlashCommand = {
  id: string;
  /** Token after the leading slash, e.g. `helix`, `spx-slayer`. */
  command: string;
  label: string;
  description: string;
  kind: LargoSlashCommandKind;
  /** Desk route for navigate commands. */
  href?: string;
  /** Exact question for prompt commands (runQuery on submit). */
  question?: string;
  /** Extra tokens for fuzzy filter (aliases, abbreviations). */
  aliases: string[];
  /** Sort weight — lower = higher in default list. */
  rank: number;
};

/** Map product tool keys to CLI-friendly slash tokens. */
const TOOL_SLASH: Record<ToolKey, { command: string; aliases: string[]; rank: number }> = {
  spx: { command: "spx-slayer", aliases: ["spx", "slayer", "dashboard"], rank: 10 },
  flows: { command: "helix", aliases: ["flow", "flows", "tape"], rank: 20 },
  heatmap: { command: "thermal", aliases: ["heatmap", "gex", "gamma"], rank: 30 },
  largo: { command: "largo", aliases: ["terminal", "desk", "ai"], rank: 40 },
  nighthawk: { command: "nighthawk", aliases: ["nh", "0dte", "zerodte", "board"], rank: 50 },
  vector: { command: "vector", aliases: ["chart", "swing"], rank: 60 },
  meridian: { command: "meridian", aliases: ["catalyst", "earnings", "macro"], rank: 70 },
};

const TOOL_DESCRIPTIONS: Record<ToolKey, string> = {
  spx: "Open SPX Slayer — structure, GEX matrix, 0DTE play engine",
  flows: "Open HELIX — institutional options flow tape",
  heatmap: "Open BlackOut Thermal — dealer gamma & vanna matrix",
  largo: "Stay on Largo — grounded desk analyst",
  nighthawk: "Open Night Hawk — 0DTE board & committed plays",
  vector: "Open Vector — live chart with dealer structure",
  meridian: "Open Meridian — catalyst & earnings desk",
};

function buildNavigateCommands(): LargoSlashCommand[] {
  return TOOLS.map((t) => {
    const slash = TOOL_SLASH[t.key];
    return {
      id: `nav-${t.key}`,
      command: slash.command,
      label: t.label,
      description: TOOL_DESCRIPTIONS[t.key],
      kind: "navigate" as const,
      href: t.href,
      aliases: slash.aliases,
      rank: slash.rank,
    };
  });
}

/** Non-social desk prompts become slash shortcuts (e.g. `/spx-setup`). */
function buildPromptCommands(): LargoSlashCommand[] {
  return LARGO_DESK_PROMPTS.filter((p) => !p.socialPack).map((p, i) => ({
    id: `prompt-${p.id}`,
    command: p.id,
    label: p.label,
    description: p.hint,
    kind: "prompt" as const,
    question: p.question,
    aliases: p.label.toLowerCase().split(/\s+/).filter(Boolean),
    rank: 100 + i,
  }));
}

/** Track record is a common jump but not in TOOLS. */
const EXTRA_NAV: LargoSlashCommand = {
  id: "nav-track-record",
  command: "track-record",
  label: "Track Record",
  description: "Open public graded outcomes & win rate",
  kind: "navigate",
  href: "/track-record",
  aliases: ["record", "stats", "wins"],
  rank: 80,
};

/** Phase C — terminal-native commands (stay in Largo, set session scope). */
const TERMINAL_COMMANDS: readonly LargoSlashCommand[] = [
  {
    id: "term-watch",
    command: "watch",
    label: "Watchlist",
    description: "Add tickers to this thread's watchlist and summarize them",
    kind: "prompt",
    question: "Summarize what matters on my watchlist right now.",
    aliases: ["wl", "follow"],
    rank: 85,
  },
  {
    id: "term-diff",
    command: "diff",
    label: "Session diff",
    description: "What changed since your last turn — spot, flip, walls, flow",
    kind: "prompt",
    question: "What changed since my last turn — spot, gamma flip, walls, and net flow?",
    aliases: ["delta", "since"],
    rank: 86,
  },
  {
    id: "term-board",
    command: "board",
    label: "0DTE board",
    description: "Night Hawk board — open plays, marks, P&L",
    kind: "prompt",
    question: "What's the 0DTE board P&L — open plays, marks, and any stopped positions?",
    aliases: ["0dte", "plays"],
    rank: 87,
  },
  {
    id: "term-trinity",
    command: "trinity",
    label: "Trinity read",
    description: "SPX · SPY · QQQ structure and flow side by side",
    kind: "prompt",
    question: "Compare SPX, SPY, and QQQ — structure, flow skew, and dealer positioning side by side.",
    aliases: ["spx spy qqq", "indices"],
    rank: 88,
  },
];

export const LARGO_SLASH_COMMANDS: readonly LargoSlashCommand[] = [
  ...buildNavigateCommands(),
  EXTRA_NAV,
  ...TERMINAL_COMMANDS,
  ...buildPromptCommands(),
];

const BY_COMMAND = new Map(LARGO_SLASH_COMMANDS.map((c) => [c.command.toLowerCase(), c]));

export function largoSlashCommandByToken(token: string): LargoSlashCommand | undefined {
  return BY_COMMAND.get(token.trim().toLowerCase());
}

/** True when the composer is in slash-autocomplete mode. */
export function largoSlashQueryFromInput(input: string): string | null {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith("/")) return null;
  // Only autocomplete the first token — `/helix NVDA` stops suggesting after space.
  const rest = trimmed.slice(1);
  if (/\s/.test(rest)) return null;
  return rest.toLowerCase();
}

export type SlashMatch = LargoSlashCommand & { score: number };

/**
 * Filter + sort slash commands for the dropdown.
 * Prefix matches rank above substring; then rank field; then label alpha.
 */
export function filterLargoSlashCommands(query: string, limit = 12): SlashMatch[] {
  const q = query.trim().toLowerCase();
  const scored: SlashMatch[] = [];

  for (const cmd of LARGO_SLASH_COMMANDS) {
    const command = cmd.command.toLowerCase();
    const label = cmd.label.toLowerCase();
    const haystack = [command, label, ...cmd.aliases.map((a) => a.toLowerCase()), cmd.description.toLowerCase()];

    let score = -1;
    if (!q) {
      score = 1000 - cmd.rank;
    } else if (command.startsWith(q)) {
      score = 900 - cmd.rank + (command === q ? 50 : command.startsWith(q) ? 20 : 0);
    } else if (label.startsWith(q)) {
      score = 800 - cmd.rank;
    } else if (cmd.aliases.some((a) => a.startsWith(q))) {
      score = 700 - cmd.rank;
    } else if (haystack.some((h) => h.includes(q))) {
      score = 500 - cmd.rank;
    }

    if (score >= 0) scored.push({ ...cmd, score });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.label.localeCompare(b.label);
  });

  return scored.slice(0, limit);
}

/** Parse `/command optional args` from composer text. */
export function parseLargoSlashInput(raw: string): {
  command: LargoSlashCommand | null;
  args: string;
} {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/")) return { command: null, args: trimmed };

  const withoutSlash = trimmed.slice(1);
  const spaceIdx = withoutSlash.search(/\s/);
  const token = (spaceIdx === -1 ? withoutSlash : withoutSlash.slice(0, spaceIdx)).toLowerCase();
  const args = spaceIdx === -1 ? "" : withoutSlash.slice(spaceIdx).trim();
  const command = largoSlashCommandByToken(token) ?? null;
  return { command, args };
}

/** Resolve navigate href — append ?ticker= when args look like a ticker. */
export function resolveSlashNavigateHref(cmd: LargoSlashCommand, args: string): string {
  const base = cmd.href ?? "/terminal";
  const ticker = args.match(/^\$?([A-Z][A-Z0-9]{0,4})\b/i)?.[1]?.toUpperCase();
  if (!ticker) return base;
  const tickerAware = ["/flows", "/heatmap", "/vector", "/dashboard", "/meridian"];
  if (!tickerAware.some((p) => base.startsWith(p))) return base;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}ticker=${encodeURIComponent(ticker)}`;
}

export type LargoSlashSubmit =
  | { type: "plain"; text: string }
  | {
      type: "query";
      question: string;
      deskScope?: string | null;
      deskScopeArgs?: DeskSlashArgs;
    };

const SINGLE_TICKER = /^\$?([A-Z][A-Z0-9]{0,4})$/i;

type SlashPromptLite = { question: string };

function slashDefaultQuestion(cmd: LargoSlashCommand, prompts: SlashPromptLite[]): string {
  if (cmd.kind === "prompt" && cmd.question) return cmd.question;
  const first = prompts[0];
  if (first) return first.question;
  return `What should I know about ${cmd.label} right now?`;
}

function deskScopeForCommand(cmd: LargoSlashCommand, rawArgs: string, parsed: DeskSlashArgs): {
  deskScope: string | null;
  deskScopeArgs: DeskSlashArgs;
} {
  if (cmd.id === "term-watch") {
    const tickers = rawArgs
      .split(/[\s,]+/)
      .map((t) => t.replace(/^\$/, "").toUpperCase())
      .filter((t) => /^[A-Z][A-Z0-9]{0,4}$/.test(t));
    return {
      deskScope: "largo",
      deskScopeArgs: { mode: "watch", watchTickers: tickers },
    };
  }
  if (cmd.id === "term-diff") {
    return { deskScope: "largo", deskScopeArgs: { mode: "diff" } };
  }
  if (cmd.id === "term-board") {
    return { deskScope: "nighthawk", deskScopeArgs: { mode: "board" } };
  }
  if (cmd.id === "term-trinity") {
    return { deskScope: "largo", deskScopeArgs: { mode: "trinity", ticker: "SPX" } };
  }
  if (cmd.kind === "navigate") {
    return {
      deskScope: cmd.command,
      deskScopeArgs: parsed,
    };
  }
  return { deskScope: null, deskScopeArgs: parsed };
}

function questionForSlash(cmd: LargoSlashCommand, args: string, parsed: DeskSlashArgs, prompts: SlashPromptLite[]): string {
  if (cmd.id === "term-watch" && parsed.watchTickers?.length) {
    return `Summarize what matters on my watchlist: ${parsed.watchTickers.join(", ")}.`;
  }
  if (cmd.kind === "prompt" && cmd.question) return cmd.question;

  const deskKey = cmd.kind === "navigate" ? cmd.command : null;
  if (parsed.submodule && deskKey) {
    const cfg = deskScopeConfig(deskKey);
    const ticker = parsed.ticker ?? cfg?.defaultTicker ?? "SPX";
    const subQ = submoduleDefaultQuestion(deskKey, parsed.submodule, ticker);
    if (subQ && !parsed.ticker) return subQ;
    if (subQ && parsed.ticker) {
      return subQ.replace(/\bSPX\b/g, parsed.ticker).replace(/\b{ticker}\b/g, parsed.ticker);
    }
  }

  if (!args) return slashDefaultQuestion(cmd, prompts);
  if (SINGLE_TICKER.test(args.trim())) return slashNavigateQuestion(cmd, args.trim());
  return args.length > 12 ? args : slashNavigateQuestion(cmd, args);
}

/** Turn composer submit text into a Largo query. Desk slash commands stay in-terminal. */
export function resolveLargoSlashSubmit(raw: string, prompts: SlashPromptLite[] = []): LargoSlashSubmit {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/")) return { type: "plain", text: trimmed };

  const { command, args } = parseLargoSlashInput(trimmed);
  if (!command) return { type: "plain", text: trimmed };

  const deskForParse = command.kind === "navigate" ? command.command : null;
  const parsedArgs = parseDeskSlashArgs(args, deskForParse);
  const { deskScope, deskScopeArgs } = deskScopeForCommand(command, args, parsedArgs);
  const question = questionForSlash(command, args, parsedArgs, prompts);

  return { type: "query", question, deskScope, deskScopeArgs };
}

/** Expand a navigate slash + args into a Largo question when member stays in-terminal. */
export function slashNavigateQuestion(cmd: LargoSlashCommand, args: string): string {
  const ticker = args.match(/^\$?([A-Z][A-Z0-9]{0,4})\b/i)?.[1]?.toUpperCase() ?? "SPX";
  switch (cmd.id) {
    case "nav-spx":
      return `What's the SPX setup right now — flip, walls, and dealer positioning?`;
    case "nav-flows":
      return ticker === "SPX"
        ? "Summarize HELIX flow on SPX — biggest prints, tide, and anything anomalous."
        : `Summarize HELIX flow on ${ticker} — biggest prints and net premium.`;
    case "nav-heatmap":
      return ticker === "SPX"
        ? "What's Thermal showing for SPX — flip, walls, gamma regime?"
        : `What's Thermal showing for ${ticker} — flip, walls, gamma regime?`;
    case "nav-nighthawk":
      return "What's the 0DTE board P&L — open plays, marks, and any stopped positions?";
    case "nav-vector":
      return `What's Vector showing for ${ticker} — structure, walls, and bias?`;
    case "nav-meridian":
      return "What's on the Meridian catalyst calendar today — earnings, macro, and top events?";
    case "nav-largo":
      return args.trim() || "What should I look at on the desk right now?";
    default:
      return args.trim() || `Open ${cmd.label} — what matters right now?`;
  }
}
