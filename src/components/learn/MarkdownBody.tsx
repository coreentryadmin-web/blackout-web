"use client";

import Link from "next/link";
import { type ReactNode } from "react";

function parseInline(text: string): ReactNode[] {
  const result: ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*|\*([^*]+?)\*|\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIdx = 0;
  let key = 0;
  let m: RegExpExecArray | null;

  while ((m = pattern.exec(text)) !== null) {
    if (m.index > lastIdx) result.push(text.slice(lastIdx, m.index));

    if (m[1] != null) {
      result.push(<strong key={key++}>{parseInline(m[1])}</strong>);
    } else if (m[2] != null) {
      result.push(<em key={key++}>{parseInline(m[2])}</em>);
    } else if (m[3] != null && m[4] != null) {
      const href = m[4];
      if (href.startsWith("/")) {
        result.push(
          <Link key={key++} href={href}>
            {m[3]}
          </Link>,
        );
      } else {
        result.push(
          <a key={key++} href={href} target="_blank" rel="noopener noreferrer">
            {m[3]}
          </a>,
        );
      }
    }
    lastIdx = pattern.lastIndex;
  }

  if (lastIdx < text.length) result.push(text.slice(lastIdx));
  return result;
}

export function MarkdownBody({ content }: { content: string }) {
  const blocks = content.split(/\n\n+/);
  const elements: ReactNode[] = [];
  let key = 0;

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("## ")) {
      const text = trimmed.slice(3);
      const id = text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
      elements.push(
        <h2 key={key++} id={id} className="learn-chapter-heading scroll-mt-24">
          {text}
        </h2>,
      );
    } else if (trimmed.startsWith("### ")) {
      elements.push(
        <h3
          key={key++}
          className="mb-4 mt-8 font-syne text-lg font-bold text-white"
        >
          {trimmed.slice(4)}
        </h3>,
      );
    } else if (trimmed.startsWith("> ")) {
      elements.push(
        <blockquote
          key={key++}
          className="mt-10 border-l-2 border-white/20 pl-4 text-sm leading-relaxed text-mute"
        >
          <p>{parseInline(trimmed.slice(2))}</p>
        </blockquote>,
      );
    } else if (/^\d+\.\s/.test(trimmed)) {
      const items = trimmed.split(/\n/).map((line) => line.replace(/^\d+\.\s+/, ""));
      elements.push(
        <ol key={key++} className="my-4 list-decimal space-y-2 pl-6">
          {items.map((item, i) => (
            <li key={i}>{parseInline(item)}</li>
          ))}
        </ol>,
      );
    } else {
      elements.push(
        <p key={key++} className="mb-5">
          {parseInline(trimmed)}
        </p>,
      );
    }
  }

  return <div className="learn-prose-body">{elements}</div>;
}
