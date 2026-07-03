// BLACKOUT Intelligence Engine — Stage 5, step 1: DRY-RUN proposals only.
//
// Stage 5's end state (docs/bie/FULL-SYSTEM-AWARENESS.md) is BIE opening its own
// PRs. That is explicitly NOT what this module does. This module NEVER writes a
// file, NEVER runs git, NEVER calls the GitHub API, and NEVER drafts an actual
// code diff. It only reads .ts/.tsx files under src/ (read-only fs access) and
// returns plain-text findings for one narrow, 100% mechanical, non-LLM-judgment
// question: does an exported component have zero references anywhere else in
// the tree? That's it. Everything past "here's an ambiguity, a human should
// decide" — including whether the answer is "delete it" or "wire it up" — is
// deliberately left to a human, because that requires knowing INTENT, which is
// not something this can verify.
//
// Why this exists: found via manual audit today (2026-07-03) that
// DashboardTrackRecordEmbed.tsx is fully unreferenced — this makes that class
// of finding continuous instead of relying on a human noticing it by chance.

import fs from "node:fs";
import path from "node:path";

export type Stage5Proposal = {
  kind: "orphaned_component";
  component: string;
  file: string;
  detail: string;
};

const SRC_ROOT = path.join(process.cwd(), "src");
const COMPONENTS_ROOT = path.join(SRC_ROOT, "components");

// export function Foo(...)  |  export default function Foo(...)  |  export const Foo = / :
const EXPORT_RE = /export\s+(?:default\s+)?function\s+([A-Z]\w+)|export\s+const\s+([A-Z]\w+)\s*[:=]/g;

function listFiles(dir: string, exts: string[]): string[] {
  let out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      out = out.concat(listFiles(full, exts));
    } else if (e.isFile() && exts.some((ext) => full.endsWith(ext)) && !full.endsWith(".test.tsx") && !full.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Pure: exported PascalCase component names declared in one file's source text. */
export function extractExportedComponentNames(fileContent: string): string[] {
  const names = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(EXPORT_RE);
  while ((m = re.exec(fileContent))) {
    const name = m[1] ?? m[2];
    if (name) names.add(name);
  }
  return [...names];
}

/** Pure: count of non-overlapping occurrences of `needle` in `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count += 1;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

/**
 * Pure: is `componentName` (declared in `definingFile`) used anywhere — either
 * in another file, OR more than once within its OWN defining file (the first
 * occurrence is the export declaration itself; a second occurrence means the
 * file uses its own export internally, e.g. a small sub-component only ever
 * rendered by the main component in the same file — real, alive code, not an
 * orphan, even though nothing imports it from outside).
 *
 * Deliberately a plain substring search, not a real import-graph resolver —
 * biased toward under-reporting (any mention at all suppresses the flag)
 * rather than over-reporting. A real resolver would need a TS language-service
 * pass this module intentionally doesn't attempt; the cost of a false negative
 * here is "an actually-dead file goes unflagged a while longer," not an
 * incorrect claim acted on.
 */
export function isReferencedElsewhere(
  componentName: string,
  definingFile: string,
  allFiles: Array<{ file: string; content: string }>
): boolean {
  for (const { file, content } of allFiles) {
    if (file === definingFile) {
      if (countOccurrences(content, componentName) > 1) return true;
      continue;
    }
    if (content.includes(componentName)) return true;
  }
  return false;
}

let cache: { at: number; proposals: Stage5Proposal[] } | null = null;
const CACHE_TTL_MS = 60 * 60_000; // filesystem content only changes on redeploy

/** DRY-RUN ONLY. Scans src/components/** for exported components referenced
 *  nowhere else in src/. Read-only fs access; returns text findings, never
 *  writes anything, never touches git. Cached for an hour (source only changes
 *  on redeploy) since this reads every file under src/ on a cache miss. */
export async function findStage5Proposals(): Promise<Stage5Proposal[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.proposals;

  try {
    const componentFiles = listFiles(COMPONENTS_ROOT, [".tsx"]);
    const allSrcFiles = listFiles(SRC_ROOT, [".ts", ".tsx"]);
    const allFiles = allSrcFiles.map((file) => {
      let content = "";
      try {
        content = fs.readFileSync(file, "utf8");
      } catch {
        content = "";
      }
      return { file, content };
    });
    const contentByFile = new Map(allFiles.map((f) => [f.file, f.content]));

    const proposals: Stage5Proposal[] = [];
    for (const file of componentFiles) {
      const content = contentByFile.get(file) ?? "";
      const exported = extractExportedComponentNames(content);
      for (const name of exported) {
        if (!isReferencedElsewhere(name, file, allFiles)) {
          const rel = path.relative(process.cwd(), file);
          proposals.push({
            kind: "orphaned_component",
            component: name,
            file: rel,
            detail: `"${name}" (${rel}) has zero references anywhere else in src/ — either dead code (safe to delete) or an unfinished/unwired feature. Cannot tell which without design intent, so this is flagged for a human decision, not a proposed deletion.`,
          });
        }
      }
    }
    cache = { at: Date.now(), proposals };
    return proposals;
  } catch {
    return [];
  }
}
