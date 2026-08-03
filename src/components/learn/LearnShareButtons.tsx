"use client";

import { useCallback, useState } from "react";
import { SITE } from "@/lib/site";

type Props = {
  title: string;
  path: string;
};

export function LearnShareButtons({ title, path }: Props) {
  const [copied, setCopied] = useState(false);
  const url = `${SITE.url}${path}`;
  const text = encodeURIComponent(title);
  const shareUrl = encodeURIComponent(url);

  const xIntent = `https://x.com/intent/tweet?text=${text}&url=${shareUrl}&via=${SITE.social.x.handle}`;

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked */
    }
  }, [url]);

  return (
    <div className="mt-6 flex flex-wrap items-center gap-3" aria-label="Share this guide">
      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-400">Share</span>
      <a
        href={xIntent}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-lg border border-white/15 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-white transition-colors hover:border-cyan-400/40 hover:text-cyan-400"
      >
        Post on X
      </a>
      <button
        type="button"
        onClick={() => void copyLink()}
        className="rounded-lg border border-white/15 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-white transition-colors hover:border-cyan-400/40 hover:text-cyan-400"
      >
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}
