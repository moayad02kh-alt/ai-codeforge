/**
 * Minimal markdown renderer for chat messages.
 *
 * Renders to React nodes only — never `dangerouslySetInnerHTML` — so text
 * coming back from a model (or, later, a real API) can never inject markup
 * into the CodeForge interface.
 */

import type { ReactNode } from 'react';
import { languageFromPath } from '../core/utils';
import { highlightBlock } from '../lib/highlight';

/** Handles `code`, **bold**, *italic* and [links]. */
function inline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;

  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const token = m[0];
    const key = `${keyBase}-i${i++}`;

    if (token.startsWith('`')) {
      nodes.push(
        <code className="md-code mono" key={key}>
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('[')) {
      const link = token.match(/\[([^\]]+)\]\(([^)]+)\)/);
      nodes.push(
        <a key={key} href={link?.[2]} target="_blank" rel="noopener noreferrer" className="md-link">
          {link?.[1]}
        </a>,
      );
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    last = m.index + token.length;
  }

  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function Markdown({ content }: { content: string }) {
  const blocks: ReactNode[] = [];
  const lines = content.split('\n');
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    /* Fenced code block */
    if (line.trimStart().startsWith('```')) {
      const lang = line.trim().slice(3).trim();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1;
      blocks.push(
        <pre className="md-pre mono" key={`b${key++}`}>
          {highlightBlock(body.join('\n'), languageFromPath(`x.${lang || 'txt'}`))}
        </pre>,
      );
      continue;
    }

    /* Heading */
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      blocks.push(
        <p className={`md-h md-h${level}`} key={`b${key++}`}>
          {inline(heading[2], `h${key}`)}
        </p>,
      );
      i += 1;
      continue;
    }

    /* Bullet list */
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ul className="md-ul" key={`b${key++}`}>
          {items.map((item, n) => (
            <li key={n}>{inline(item, `u${key}-${n}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    /* Numbered list */
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ol className="md-ol" key={`b${key++}`}>
          {items.map((item, n) => (
            <li key={n}>{inline(item, `o${key}-${n}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    /* Blockquote */
    if (line.trimStart().startsWith('>')) {
      const body: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith('>')) {
        body.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      blocks.push(
        <blockquote className="md-quote" key={`b${key++}`}>
          {inline(body.join(' '), `q${key}`)}
        </blockquote>,
      );
      continue;
    }

    /* Blank line */
    if (!line.trim()) {
      i += 1;
      continue;
    }

    /* Paragraph — greedily consume until a structural break */
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trimStart().startsWith('```') &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^#{1,4}\s/.test(lines[i]) &&
      !lines[i].trimStart().startsWith('>')
    ) {
      para.push(lines[i]);
      i += 1;
    }
    blocks.push(
      <p className="md-p" key={`b${key++}`}>
        {inline(para.join(' '), `p${key}`)}
      </p>,
    );
  }

  return <div className="md">{blocks}</div>;
}
