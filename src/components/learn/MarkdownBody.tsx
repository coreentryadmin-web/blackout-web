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

function parseTableBlock(block: string, tableKey: number): ReactNode {
  const lines = block.trim().split("\n").map((l) => l.trim());
  const headerCells = lines[0]
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
  const bodyLines = lines.slice(2);
  return (
    <div key={tableKey} className="my-6 overflow-x-auto rounded-xl border border-white/10">
      <table className="min-w-full text-left text-sm">
        <thead>
          <tr className="border-b border-white/10 bg-white/[0.03]">
            {headerCells.map((cell, i) => (
              <th key={i} className="px-4 py-2.5 font-syne text-xs font-bold uppercase tracking-wide text-white/80">
                {parseInline(cell)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bodyLines.map((line, ri) => {
            const cells = line
              .replace(/^\|/, "")
              .replace(/\|$/, "")
              .split("|")
              .map((c) => c.trim());
            return (
              <tr key={ri} className="border-b border-white/[0.06] last:border-0">
                {cells.map((cell, ci) => (
                  <td key={ci} className="px-4 py-2.5 align-top text-white/70">
                    {parseInline(cell)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function isGfmTableBlock(trimmed: string): boolean {
  const lines = trimmed.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return false;
  if (!lines.every((l) => l.startsWith("|") && l.endsWith("|"))) return false;
  return /^\|[\s\-:|]+\|$/.test(lines[1]);
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
    } else if (/^!\[[^\]]*\]\([^)]+\)/.test(trimmed)) {
      // Standalone image block: `![alt](/src)` with an optional `*caption*` on the next line.
      // width/height are set from the known asset ratio so the browser reserves the space and the
      // image adds ZERO layout shift (see the homepage-CLS fix — never ship a CLS regression).
      const lines = trimmed.split(/\n/);
      const m = lines[0].match(/^!\[([^\]]*)\]\(([^)]+)\)/);
      const alt = m?.[1] ?? "";
      const src = m?.[2] ?? "";
      const capLine = lines[1]?.trim() ?? "";
      const caption = /^\*.*\*$/.test(capLine) ? capLine.replace(/^\*|\*$/g, "") : "";
      elements.push(
        <figure key={key++} className="my-8">
          {/* eslint-disable-next-line @next/next/no-img-element -- committed static diagram, not remote/user content */}
          <img
            src={src}
            alt={alt}
            width={1200}
            height={630}
            loading="lazy"
            className="w-full rounded-xl border border-white/10"
            style={{ height: "auto" }}
          />
          {caption ? (
            <figcaption className="mt-3 text-center text-sm text-mute">{parseInline(caption)}</figcaption>
          ) : null}
        </figure>,
      );
    } else if (isGfmTableBlock(trimmed)) {
      elements.push(parseTableBlock(trimmed, key++));
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
