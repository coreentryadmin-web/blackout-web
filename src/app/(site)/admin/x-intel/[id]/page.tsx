"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import type { XIntelQueueRow } from "@/lib/x-intel/queue-types";

export default function XIntelDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [row, setRow] = useState<XIntelQueueRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tweetId, setTweetId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchRow();
  }, [id]);

  async function fetchRow() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/x-intel/queue?limit=1`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      const found = data.rows?.find((r: XIntelQueueRow) => String(r.id) === id);
      if (!found) throw new Error("Row not found");

      setRow(found);
      if (found.posted_tweet_id) {
        setTweetId(found.posted_tweet_id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load row");
    } finally {
      setLoading(false);
    }
  }

  async function recordTweetId(e: React.FormEvent) {
    e.preventDefault();
    if (!row || !tweetId.trim()) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/x-intel/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cycle_key: row.cycle_key,
          tweet_id: tweetId.trim(),
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || `HTTP ${res.status}`);
      }

      // Refetch to get the updated row
      await fetchRow();
      alert("Tweet ID recorded successfully!");
    } catch (err) {
      alert(
        `Error: ${err instanceof Error ? err.message : "Failed to record tweet ID"}`,
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="text-center py-8 text-white/30">Loading...</div>
      </div>
    );
  }

  if (error || !row) {
    return (
      <div className="p-6">
        <div className="p-4 bg-red-100 border border-red-400 text-red-700 rounded">
          {error || "Row not found"}
        </div>
        <Link href="/admin/x-intel" className="mt-4 text-blue-600 hover:underline">
          ← Back to queue
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <Link href="/admin/x-intel" className="text-blue-600 hover:underline mb-4 block">
        ← Back to queue
      </Link>

      <div className="mb-6">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold mb-2">{row.headline}</h1>
            <div className="flex gap-4 text-sm text-white/40">
              <span>ID: {row.id}</span>
              <span>Cycle: {row.cycle_key}</span>
              <span>Session: {row.session_date}</span>
            </div>
          </div>
          <span
            className={`px-4 py-2 rounded font-mono font-bold ${
              row.status === "READY"
                ? "bg-green-100 text-green-800"
                : row.status === "REVIEW"
                  ? "bg-yellow-100 text-yellow-800"
                  : "bg-white/10 text-white"
            }`}
          >
            {row.status}
          </span>
        </div>
      </div>

      {/* Post copy — the thing to paste on X */}
      <div className="mb-6 p-4 border-2 border-blue-200 bg-blue-50 rounded">
        <h2 className="font-bold mb-2">Post Copy (paste on X)</h2>
        <p className="font-mono whitespace-pre-wrap text-sm">{row.post_copy || "(empty)"}</p>
      </div>

      {/* Attachments */}
      {row.attachments.length > 0 && (
        <div className="mb-6">
          <h2 className="font-bold mb-3">Attachments ({row.attachments.length})</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {row.attachments.map((a, i) => (
              <div key={i} className="border border-white/10 rounded p-3">
                <div className="font-bold text-sm mb-1">{a.role}</div>
                <div className="text-xs text-white/40 mb-2">
                  {a.source_surface} · {a.captured_at_et}
                </div>
                {a.image_url && (
                  <a
                    href={a.image_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block mb-2"
                  >
                    <img
                      src={a.image_url}
                      alt={a.caption}
                      className="max-h-40 w-full object-cover rounded border"
                    />
                  </a>
                )}
                <p className="text-xs">{a.caption}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Structured evidence */}
      <div className="grid grid-cols-2 gap-6 mb-6">
        {row.products_referenced && row.products_referenced.length > 0 && (
          <div>
            <h3 className="font-bold mb-2">Products Referenced</h3>
            <ul className="text-sm space-y-1">
              {(row.products_referenced as string[]).map((p) => (
                <li key={p} className="font-mono bg-white/10 px-2 py-1 rounded">
                  {p}
                </li>
              ))}
            </ul>
          </div>
        )}

        {row.confidence && (
          <div>
            <h3 className="font-bold mb-2">Confidence</h3>
            <div className="text-sm">
              <div className="font-mono mb-1">
                Score: {(row.confidence.score * 100).toFixed(0)}%
              </div>
              <div className="text-white/40">Basis: {row.confidence.basis}</div>
              {row.confidence.sample_size && (
                <div className="text-white/40">n = {row.confidence.sample_size}</div>
              )}
            </div>
          </div>
        )}
      </div>

      {row.underlying_evidence && row.underlying_evidence.length > 0 && (
        <div className="mb-6">
          <h3 className="font-bold mb-2">Underlying Evidence</h3>
          <div className="bg-white/5 rounded p-3 text-sm space-y-1">
            {(row.underlying_evidence as any[]).map((e, i) => (
              <div key={i} className="font-mono text-xs">
                {e.what}: {e.value} ({e.source})
                {e.horizon && e.horizon !== "n/a" && ` [${e.horizon}]`}
              </div>
            ))}
          </div>
        </div>
      )}

      {row.chronology && row.chronology.precedence_claimed && (
        <div className="mb-6 p-4 border-l-4 border-purple-400 bg-purple-50 rounded">
          <h3 className="font-bold mb-2">Precedence Claim</h3>
          <div className="text-sm space-y-1">
            {row.chronology.detection && (
              <div>
                <span className="text-white/40">Detection:</span>
                <span className="font-mono ml-2">{row.chronology.detection.at_et}</span>
              </div>
            )}
            {row.chronology.market_event && (
              <div>
                <span className="text-white/40">Market Event:</span>
                <span className="font-mono ml-2">{row.chronology.market_event.at_et}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {row.reason_selected && (
        <div className="mb-6">
          <h3 className="font-bold mb-2">Why This Package?</h3>
          <p className="text-sm text-white/40">{row.reason_selected}</p>
        </div>
      )}

      {/* Record tweet ID */}
      <form onSubmit={recordTweetId} className="mb-6 p-4 border border-white/10 rounded bg-white/5">
        <h3 className="font-bold mb-3">After Publishing to X</h3>
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            placeholder="Paste the X/Twitter post ID here..."
            value={tweetId}
            onChange={(e) => setTweetId(e.target.value)}
            className="flex-1 px-3 py-2 border rounded font-mono text-sm"
          />
          <button
            type="submit"
            disabled={submitting || !tweetId.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition"
          >
            {submitting ? "Recording..." : "Record"}
          </button>
        </div>
        <p className="text-xs text-white/40">
          The tweet ID is the number in the X URL. Example:
          https://x.com/user/status/
          <span className="font-mono">1234567890</span>
        </p>
      </form>

      {row.posted_tweet_id && (
        <div className="p-4 bg-green-50 border border-green-200 rounded">
          <div className="text-sm">
            <span className="text-white/40">Posted at:</span>
            <a
              href={`https://x.com/i/web/status/${row.posted_tweet_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-blue-600 hover:underline ml-2"
            >
              x.com/i/web/status/{row.posted_tweet_id}
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
