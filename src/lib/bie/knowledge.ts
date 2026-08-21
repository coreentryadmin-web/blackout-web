// BLACKOUT Intelligence Engine — Layer 2 knowledge store + retrieval.
// Everything the desk learns becomes a searchable chunk: playbooks and docs,
// audit findings, Night Hawk editions and outcomes, 0DTE session recaps, daily
// self-eval reports. Embeddings are env-gated (VOYAGE_API_KEY): without the key
// chunks are stored un-embedded and retrieval stays cold — the platform never
// degrades because a key is missing; it just gets smarter the moment one lands.

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  dbConfigured,
  fetchBieKnowledge,
  fetchExistingBieHashes,
  fetchLatestNighthawkEdition,
  insertBieKnowledge,
  updateBieKnowledgeEmbeddings,
  type BieKnowledgeRow,
} from "@/lib/db";
import { bieEmbeddingsConfigured, chunkDocument, cosine, embedTexts } from "./embeddings";

const hashOf = (s: string): string => createHash("sha256").update(s).digest("hex").slice(0, 40);

export type KnowledgeKind = "doc" | "finding" | "edition" | "zerodte_recap" | "self_eval" | "precedent";

type ChunkRef = { chunk: string; chunk_hash: string };

/** Split chunks into what needs INSERTING (never seen) vs what needs its
 *  embedding BACKFILLED (stored cold before the key existed). Pure + tested —
 *  this partition is what makes "add the key later" actually work: without the
 *  cold set, hash-dedup would skip un-embedded chunks forever. */
export function partitionForEmbedding(
  all: ChunkRef[],
  existing: Map<string, boolean>,
  embeddingsOn: boolean
): { fresh: ChunkRef[]; cold: ChunkRef[] } {
  return {
    fresh: all.filter((c) => !existing.has(c.chunk_hash)),
    cold: embeddingsOn ? all.filter((c) => existing.get(c.chunk_hash) === false) : [],
  };
}

/** Store chunks (hash-deduped); embed when configured, store cold otherwise.
 *  Chunks stored cold in a previous run are backfilled once a key lands. */
export async function storeKnowledge(
  kind: KnowledgeKind,
  source: string,
  text: string
): Promise<number> {
  if (!dbConfigured() || !text.trim()) return 0;
  const all = chunkDocument(text).map((chunk) => ({
    chunk,
    chunk_hash: hashOf(`${kind}|${source}|${chunk}`),
  }));
  if (all.length === 0) return 0;
  // Dedup BEFORE embedding: unchanged content re-ingests for free — the daily
  // cron never re-pays the embeddings provider for the same EMBEDDED chunk
  // twice. Cold chunks are the exception: they get one embed to backfill.
  const existing = await fetchExistingBieHashes(all.map((c) => c.chunk_hash)).catch(
    () => new Map<string, boolean>()
  );
  const { fresh, cold } = partitionForEmbedding(all, existing, bieEmbeddingsConfigured());
  if (fresh.length === 0 && cold.length === 0) return 0;
  let embeddings: (number[] | null)[] = fresh.map(() => null);
  let coldEmbeddings: number[][] = [];
  if (bieEmbeddingsConfigured()) {
    try {
      // One provider call for both sets — fresh first, then backfills.
      const embedded = await embedTexts([...fresh, ...cold].map((c) => c.chunk), "document");
      embeddings = embedded.slice(0, fresh.length);
      coldEmbeddings = embedded.slice(fresh.length);
    } catch {
      // Store cold — the next ingest retries the backfill; never lose
      // knowledge over an embed hiccup.
      embeddings = fresh.map(() => null);
      coldEmbeddings = [];
    }
  }
  let written = 0;
  if (fresh.length > 0) {
    written += await insertBieKnowledge(
      fresh.map((c, i) => ({
        kind,
        source,
        chunk: c.chunk,
        chunk_hash: c.chunk_hash,
        embedding: embeddings[i] ?? null,
      }))
    );
  }
  if (coldEmbeddings.length > 0) {
    written += await updateBieKnowledgeEmbeddings(
      cold.map((c, i) => ({ chunk_hash: c.chunk_hash, embedding: coldEmbeddings[i]! }))
    );
  }
  return written;
}

export type RetrievedChunk = { source: string; kind: string; chunk: string; similarity: number };

/** Top-k knowledge for a question — embeds the query, ranks stored chunks by
 *  cosine in Node (corpus is thousands of chunks, not millions). Returns [] when
 *  embeddings aren't configured or nothing clears the similarity floor. */
// Evidence-calibrated 2026-07-03 (docs/audit/FINDINGS.md — BIE retrieval-floor
// entry): 4 representative questions against the live voyage-3 corpus returned
// correct top-1 matches at 0.348-0.562 similarity and correct top-3 matches
// down to 0.256 — the prior 0.55 floor (an untested guess predating any real
// embeddings) passed only 1 of 12 genuinely relevant hits. 0.30 keeps every
// top-1 match and 10 of 12 total hits from that evidence set while still
// excluding pure noise. Re-derive from a fresh probe set before moving it again.
// (Inherited as the starting default for the "precedent" kind too — that
// corpus is short templated descriptions, not prose, and hasn't had its own
// evidence pass yet; re-derive once real precedent queries accumulate.)
export const DEFAULT_MIN_SIMILARITY = 0.3;

/** How many stored chunks are pulled as ranking candidates. NOT a top-k — the
 *  whole set is cosine-ranked in Node and only then cut to `k`.
 *
 *  This is the bound that governs how large the corpus can usefully get:
 *  fetchBieKnowledge orders by `created_at DESC`, so anything past it is not
 *  merely ranked lower, it is never scored. fetchBieKnowledge itself hard-caps
 *  at 1000, so this cannot be raised past that without a db.ts change, and
 *  raising it at all only moves the cliff — the real fix is ranking the corpus
 *  (pgvector, or paging every embedded row) rather than its newest slice. Left
 *  at the shipped value here deliberately: this PR makes the truncation VISIBLE
 *  rather than silently re-tuning a number nobody has measured retrieval
 *  quality against. See docs/audit/FINDINGS.md (2026-08-21, BIE ingestion caps). */
export const RETRIEVAL_CANDIDATE_LIMIT = 800;

/** `kind` optionally scopes retrieval to one knowledge kind (e.g. "precedent")
 *  instead of ranking across the whole corpus — same embed-and-cosine-rank
 *  logic either way, just a narrower candidate set from fetchBieKnowledge. */
export async function searchKnowledge(
  query: string,
  k = 3,
  minSimilarity = DEFAULT_MIN_SIMILARITY,
  kind?: KnowledgeKind
): Promise<RetrievedChunk[]> {
  if (!dbConfigured() || !bieEmbeddingsConfigured()) return [];
  try {
    const [qEmb] = await embedTexts([query], "query");
    if (!qEmb) return [];
    const rows = await fetchBieKnowledge({ limit: RETRIEVAL_CANDIDATE_LIMIT, kind });
    // Same rule as the ingestion caps, one layer down. fetchBieKnowledge is
    // `ORDER BY created_at DESC LIMIT n`, so this is a RECENCY WINDOW, not the
    // corpus — once the store exceeds it, the oldest chunks stop being
    // rankable at all and retrieval silently answers from a subset. Saying so
    // is the difference between a known bound and an invisible one.
    if (rows.length >= RETRIEVAL_CANDIDATE_LIMIT) {
      console.warn(
        `[bie] retrieval candidate window SATURATED at ${RETRIEVAL_CANDIDATE_LIMIT}` +
          `${kind ? ` (kind=${kind})` : ""} — older chunks are outside the ranked set`
      );
    }
    const scored = rows
      .filter((r): r is BieKnowledgeRow & { embedding: number[] } => Array.isArray(r.embedding))
      .map((r) => ({ source: r.source, kind: r.kind, chunk: r.chunk, similarity: cosine(qEmb, r.embedding) }))
      .filter((r) => r.similarity >= minSimilarity)
      .sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, k);
  } catch {
    return [];
  }
}

// ── Ingestion (daily, from the db-cleanup cron) ──────────────────────────────────

const DOC_DIRS = ["docs", "docs/bie", "docs/audit"];
const ROOT_DOCS = ["AGENTS.md", "CLAUDE.md"];

/** Ingestion bounds. Both are REPORTED, never silent — see SkippedDoc.
 *
 *  Why these are NOT simply raised (measured 2026-08-21, at 1.73M-char
 *  FINDINGS.md): cost is not the binding constraint. A full first ingest of
 *  FINDINGS.md is 1,799 chunks / 15 batched Voyage calls / ~464k tokens /
 *  ~$0.028, and hash-dedup makes the recurring daily cost a median ~$0.0004
 *  (worst observed day $0.0065, measured over 31 days of real history). Dedup
 *  survives edits at the TOP of the file because chunkDocument resynchronises:
 *  62.5% of FINDINGS.md's characters sit in paragraphs at or over the 1200-char
 *  cap (single-line table rows), and each of those forces its own boundary — so
 *  inserting a new entry does not re-chunk the 13k lines below it.
 *
 *  The binding constraint is RETRIEVAL, one layer down: searchKnowledge() ranks
 *  whatever fetchBieKnowledge() returns, and that is `ORDER BY created_at DESC
 *  LIMIT <=1000` — a RECENCY WINDOW, not the corpus. Today's ingested corpus is
 *  ~513 doc chunks and fits. FINDINGS.md alone is 1,799 chunks = >2x the 800
 *  the unscoped Largo path asks for, so ingesting it whole would evict every
 *  other doc from retrieval entirely: knowledge would enter the store and leave
 *  reach in the same run. Lifting either bound (or making the walk recursive —
 *  137 .md files exist under docs/, only 63 are visible to DOC_DIRS) is blocked
 *  on retrieval ranking the corpus rather than a recency window. Tracked in
 *  docs/audit/FINDINGS.md (2026-08-21, BIE ingestion caps).
 */
export const MAX_INGEST_FILES = 40;
export const MAX_DOC_CHARS = 400_000;

/** What a bound DISCARDED, and why. Returned and logged so a cap can never
 *  again present a truncated corpus as a complete one — the failure that let
 *  FINDINGS.md sit un-ingested from 2026-07-31 without anything noticing. */
export type SkippedDoc = {
  source: string;
  reason: "file_cap" | "size_cap" | "unreadable" | "store_failed";
  detail?: string;
};

/** Hand-maintained on purpose — "is this stage done, is autonomy authorized" is
 *  a judgment call, not a fact grep can extract. Kept small and in one place
 *  (not buried in ARCHITECTURE.md prose) specifically so it stays cheap to
 *  audit and update the moment a stage's status actually changes. */
const BIE_STAGE_STATUS: { stage: string; status: string }[] = [
  { stage: "Stage 1 — docs/knowledge ingestion, API usage telemetry", status: "SHIPPED" },
  { stage: "Stage 2 — logs, errors, cron/worker health, duplicate/missed-alert detection", status: "SHIPPED (zero new credentials — reads tables the app already writes)" },
  { stage: "Stage 3 — ECS/Postgres/Redis/Clerk-auth infra access", status: "SHIPPED" },
  { stage: "Stage 4 — unified alert_audit_log across 0DTE + Night Hawk (published + rejected)", status: "SHIPPED" },
  { stage: "Stage 5 step 1 — dry-run orphaned-component text proposals", status: "SHIPPED, deliberately narrow: never writes a file, never runs git, never opens a PR. Stage 5's actual end state (BIE opening its own PRs) is NOT built and NOT authorized." },
  { stage: "Stage 6 — using outcome data to calibrate live scoring", status: "NOT STARTED, NOT AUTHORIZED. Every precursor measurement (e.g. confluence outcomes) is read-only and reports numbers; none of it acts on them." },
];

/** The ordered candidate list the ingest walks, exported so the guard test
 *  exercises the REAL ordering rather than a copy of it that cannot regress.
 *
 *  ROOT_DOCS go FIRST, not last: CLAUDE.md and AGENTS.md define how this
 *  platform operates, and appending them after the directory walk put them at
 *  positions 64-65 of 65 — i.e. permanently past MAX_INGEST_FILES, so the two
 *  most load-bearing documents in the repo were the only two guaranteed never
 *  to reach the corpus. Nothing about them is optional enough to be tail.
 *
 *  Sorted within each dir: readdir(3) order is unspecified by POSIX and Node
 *  does not sort. It comes back sorted on ext4, but production runs on an
 *  overlayfs image layer — without this, WHICH files fall past the cap could
 *  differ between environments, making the drop set irreproducible. */
export function ingestCandidateDocs(): string[] {
  const files: string[] = [...ROOT_DOCS];
  for (const dir of DOC_DIRS) {
    try {
      const names = readdirSync(join(process.cwd(), dir))
        .filter((name) => name.endsWith(".md"))
        .sort();
      for (const name of names) files.push(join(dir, name));
    } catch {
      // missing dir in some deploys — fine
    }
  }
  return files;
}

/** Ingest the platform's own knowledge: docs, findings, the latest Night Hawk
 *  edition recap. Hash-dedup makes this idempotent — unchanged content is free. */
export async function ingestBieKnowledge(): Promise<{ stored: number; skipped: SkippedDoc[] }> {
  if (!dbConfigured()) return { stored: 0, skipped: [] };
  let stored = 0;
  const skipped: SkippedDoc[] = [];

  // Markdown docs (platform + audit knowledge).
  const files = ingestCandidateDocs();
  for (const rel of files.slice(MAX_INGEST_FILES)) {
    skipped.push({ source: rel, reason: "file_cap", detail: `beyond first ${MAX_INGEST_FILES} docs` });
  }
  for (const rel of files.slice(0, MAX_INGEST_FILES)) {
    // Read and store are caught SEPARATELY: a doc that read fine but failed to
    // embed/insert is a different fact from one that could not be read, and
    // reporting the second as the first would be exactly the kind of quiet
    // mislabelling this reporting exists to end.
    let text: string;
    try {
      // Read-then-bound (no stat-then-read TOCTOU): oversized docs are skipped
      // after the read. These are the repo's OWN markdown docs — a fixed,
      // deploy-time allowlist, never user input — and sending their content to
      // the configured embeddings provider is the documented purpose of this
      // function (docs/bie/ARCHITECTURE.md, Layer 2).
      text = readFileSync(join(process.cwd(), rel), "utf8");
    } catch (err) {
      skipped.push({
        source: rel,
        reason: "unreadable",
        detail: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    if (text.length > MAX_DOC_CHARS) {
      skipped.push({
        source: rel,
        reason: "size_cap",
        detail: `${text.length} chars > ${MAX_DOC_CHARS}`,
      });
      continue;
    }
    try {
      stored += await storeKnowledge(rel.includes("audit") ? "finding" : "doc", rel, text);
    } catch (err) {
      // Fail-open per the rest of this function — one bad doc never aborts the
      // daily ingest — but no longer fail-SILENT.
      skipped.push({
        source: rel,
        reason: "store_failed",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Platform self-knowledge (Phase 4 groundwork): a generated map of the desk's
  // own tools and crons, so BIE can answer questions about the platform itself.
  try {
    const [{ TOOLS }, { CRON_JOBS }] = await Promise.all([
      import("@/lib/tool-access"),
      import("@/lib/cron-registry"),
    ]);
    const toolLines = TOOLS.map((t) => `- ${t.label} (${t.key}) at ${t.href}`).join("\n");
    const cronLines = CRON_JOBS.map(
      (c) => `- ${c.name} (${c.key}): ${c.schedule_label} — ${c.description}`
    ).join("\n");
    const text = `BLACKOUT platform map (generated).\n\nMember tools:\n${toolLines}\n\nScheduled jobs:\n${cronLines}`;
    stored += await storeKnowledge("doc", "platform:map", text);
  } catch {
    // registries unavailable in some contexts — skip
  }

  // Foundational concept glossary (code-grounded definitions of GEX/VEX/King node/max pain/regime/
  // the products, etc.). The deterministic lookupGlossary() in glossary.ts is the PRIMARY path for
  // "what is X" questions; ingesting the same text here is belt-and-suspenders so the RAG/embedding
  // layer also has correct definitions once Voyage is configured (the existing member glossary in
  // src/lib/learn/guides/glossary.ts was never in the corpus — this closes that gap with the
  // canonical, precise definitions rather than the generic ones).
  try {
    const { glossaryKnowledgeText } = await import("./glossary");
    stored += await storeKnowledge("doc", "platform:glossary", glossaryKnowledgeText());
  } catch {
    // glossary import unavailable in some contexts — skip
  }

  // The governed READ-route allowlist BIE may call (route-registry.ts) — so BIE knows which internal
  // endpoints it can pull from and that they're read-only. Generated from the registry, never
  // hand-typed, so it can't drift from the actual allowlist.
  try {
    const { routeRegistryKnowledgeText } = await import("@/lib/route-registry");
    stored += await storeKnowledge("doc", "platform:routes", routeRegistryKnowledgeText());
  } catch {
    // registry unavailable in some contexts — skip
  }

  // BIE self-knowledge (generated, not hand-typed): the tool/field inventory
  // read straight from the source of truth (tool-defs.ts, ecosystem-context.ts)
  // instead of prose that has to be remembered and kept in sync by hand. This is
  // the fix for the 2026-07-04 incident where docs/bie/ARCHITECTURE.md described
  // only the very first BIE PR and Largo repeated that stale answer to a member
  // (docs/audit/FINDINGS.md) — the tool/field list can no longer drift out of
  // date because it is regenerated from real exports on every ingest, not edited
  // by a human who has to remember to. Stage rollout status is still a judgment
  // call (is a stage "done," is autonomy authorized) and stays hand-maintained
  // below, deliberately small so drift here is cheap to notice and fix.
  try {
    const [{ LARGO_TOOL_DEFS, BIE_TOOL_NAMES }, { ECOSYSTEM_CONTEXT_FIELDS }] = await Promise.all([
      import("@/lib/largo/tool-defs"),
      import("./ecosystem-context"),
    ]);
    const bieTools = LARGO_TOOL_DEFS.filter((td) => (BIE_TOOL_NAMES as string[]).includes(td.name));
    const toolLines = bieTools.map((td) => `- ${td.name}: ${td.description}`).join("\n\n");
    const fieldLines = ECOSYSTEM_CONTEXT_FIELDS.map((f) => `- ${f.field}: ${f.description}`).join("\n");
    const stageLines = BIE_STAGE_STATUS.map((s) => `- ${s.stage}: ${s.status}`).join("\n");
    const text = [
      "BLACKOUT Intelligence Engine — live capabilities (generated from source, not hand-typed).",
      `\nLargo tools BIE provides (${bieTools.length} today — count and descriptions read live from src/lib/largo/tool-defs.ts):\n${toolLines}`,
      `\nfetchEcosystemContext() fields — one ticker's cross-instrument snapshot:\n${fieldLines}`,
      `\nRollout stage status (hand-maintained — see docs/bie/FULL-SYSTEM-AWARENESS.md for full evidence):\n${stageLines}`,
    ].join("\n");
    stored += await storeKnowledge("doc", "platform:bie-capabilities", text);
  } catch {
    // registries unavailable in some contexts — skip, same fail-open as platform:map
  }

  // Semantic precedent search: every RESOLVED alert from the last 60 days
  // becomes one embedded "precedent" chunk (src/lib/bie/precedent-search.ts) —
  // dynamic import to avoid a knowledge.ts <-> precedent-search.ts import
  // cycle, same pattern as the tool-defs/ecosystem-context import above.
  try {
    const { ingestAlertPrecedents } = await import("./precedent-search");
    const { stored: precedentsStored } = await ingestAlertPrecedents(60);
    stored += precedentsStored;
  } catch {
    // db/embeddings unavailable in some contexts — skip, same fail-open as everything else here
  }

  // Latest Night Hawk edition — recap + play theses become searchable history.
  try {
    const edition = await fetchLatestNighthawkEdition();
    if (edition) {
      const plays = (Array.isArray(edition.plays) ? edition.plays : [])
        .map((p) => {
          const o = p as Record<string, unknown>;
          return `${o.ticker ?? "?"} ${o.direction ?? ""}: ${o.thesis ?? o.headline ?? ""}`.trim();
        })
        .filter((s) => s.length > 5)
        .join("\n");
      const text = [
        `Night Hawk edition for ${edition.edition_for}.`,
        edition.recap_headline ?? "",
        edition.recap_summary ?? "",
        plays,
      ]
        .filter(Boolean)
        .join("\n\n");
      stored += await storeKnowledge("edition", `nighthawk:${edition.edition_for}`, text);
    }
  } catch {
    // best-effort
  }

  // Announce the truncation. A cap that reports itself is a design decision; a
  // cap that stays quiet is a bug waiting to be found by accident — which is
  // exactly how FINDINGS.md (the findings corpus itself) went un-ingested.
  if (skipped.length > 0) {
    const bySource = skipped.map((s) => `${s.source} (${s.reason})`).join(", ");
    console.warn(`[bie] ingest skipped ${skipped.length} doc(s): ${bySource}`);
  }
  return { stored, skipped };
}
