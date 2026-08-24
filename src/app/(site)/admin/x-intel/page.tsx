"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { etDateTimeShort } from "@/lib/et-clock";
import type { XIntelQueueRow, XIntelStatus } from "@/lib/x-intel/queue-types";

export default function XIntelQueuePage() {
  const [rows, setRows] = useState<XIntelQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<XIntelStatus | "ALL">("ALL");

  useEffect(() => {
    fetchQueueRows();
  }, [status]);

  async function fetchQueueRows() {
    setLoading(true);
    setError(null);
    try {
      const url = new URL("/api/admin/x-intel/queue", window.location.origin);
      url.searchParams.set("status", status);
      url.searchParams.set("limit", "50");

      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      setRows(data.rows || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load queue");
    } finally {
      setLoading(false);
    }
  }

  function formatDate(d: string | Date | null | undefined): string {
    return etDateTimeShort(d) || "(unknown)";
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">X Intel Queue</h1>
        <Link
          href="/admin"
          className="text-sm px-3 py-2 rounded bg-gray-200 hover:bg-gray-300 transition"
        >
          ← Back to Admin
        </Link>
      </div>

      {/* Status filter */}
      <div className="mb-6 flex gap-2">
        {(["ALL", "READY", "REVIEW", "SKIP"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`px-4 py-2 rounded transition ${
              status === s
                ? "bg-blue-600 text-white"
                : "bg-gray-200 hover:bg-gray-300"
            }`}
          >
            {s} ({s === "ALL" ? "all" : s.toLowerCase()})
          </button>
        ))}
      </div>

      {error && (
        <div className="p-4 mb-4 bg-red-100 border border-red-400 text-red-700 rounded">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-8 text-gray-500">Loading queue...</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-8 text-gray-500">No {status} rows</div>
      ) : (
        <div className="space-y-4">
          {rows.map((row) => (
            <div
              key={row.id}
              className="border rounded-lg p-4 hover:bg-gray-50 transition"
            >
              <div className="flex justify-between items-start mb-2">
                <div>
                  <h3 className="font-bold text-lg">{row.headline}</h3>
                  <p className="text-sm text-gray-600">
                    {row.ticker_or_market} · {row.franchise}
                  </p>
                </div>
                <div className="text-right">
                  <span
                    className={`inline-block px-3 py-1 rounded text-sm font-mono ${
                      row.status === "READY"
                        ? "bg-green-100 text-green-800"
                        : row.status === "REVIEW"
                          ? "bg-yellow-100 text-yellow-800"
                          : "bg-gray-100 text-gray-800"
                    }`}
                  >
                    {row.status}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm mb-3">
                <div>
                  <span className="text-gray-600">Created</span>
                  <p className="font-mono">{formatDate(row.created_at)}</p>
                </div>
                <div>
                  <span className="text-gray-600">Session</span>
                  <p className="font-mono">{row.session_date}</p>
                </div>
              </div>

              {row.post_copy && (
                <div className="mb-3 p-2 bg-gray-50 rounded border border-gray-200 text-sm">
                  <div className="text-gray-600 mb-1">Post Copy</div>
                  <p className="line-clamp-3">{row.post_copy}</p>
                </div>
              )}

              {row.attachments.length > 0 && (
                <div className="mb-3">
                  <div className="text-gray-600 text-sm mb-1">
                    Attachments ({row.attachments.length})
                  </div>
                  <div className="flex gap-2">
                    {row.attachments.map((a, i) => (
                      <a
                        key={i}
                        href={a.image_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition"
                      >
                        {a.role}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {row.confidence && (
                <div className="mb-3 text-sm">
                  <div className="text-gray-600 mb-1">Confidence</div>
                  <p className="font-mono">
                    {(row.confidence.score * 100).toFixed(0)}% · {row.confidence.basis}
                  </p>
                </div>
              )}

              {row.reason_selected && (
                <div className="mb-3 text-sm">
                  <div className="text-gray-600 mb-1">Reason Selected</div>
                  <p className="font-mono">{row.reason_selected}</p>
                </div>
              )}

              <div className="flex gap-2 pt-3 border-t">
                <Link
                  href={`/admin/x-intel/${row.id}`}
                  className="flex-1 px-3 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 transition text-center"
                >
                  Review Details
                </Link>
                {row.status === "READY" && !row.posted_tweet_id && (
                  <button
                    className="flex-1 px-3 py-2 bg-green-600 text-white rounded text-sm hover:bg-green-700 transition"
                    onClick={() => {
                      const url = row.post_copy || `Check queue row ${row.id}`;
                      console.log("Would publish to X:", url);
                      alert(
                        "Publishing is a manual step via X web. Copy the post_copy to paste on X, then record the tweet ID via the Details page.",
                      );
                    }}
                  >
                    → Publish to X
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
