/**
 * Lightweight syntax highlighter.
 *
 * A tokenizer small enough to ship without a dependency, covering the
 * languages the agent generates. It returns React nodes, so there is no
 * `dangerouslySetInnerHTML` anywhere in the editor — generated code can never
 * inject markup into the CodeForge UI itself.
 */

import type { ReactNode } from 'react';
import type { FileLanguage } from '../core/types';

type TokenType =
  | 'keyword'
  | 'string'
  | 'comment'
  | 'number'
  | 'function'
  | 'tag'
  | 'attr'
  | 'property'
  | 'selector'
  | 'operator'
  | 'punct'
  | 'plain';

interface Rule {
  type: TokenType;
  re: RegExp;
}

const JS_KEYWORDS =
  'const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|class|extends|super|this|typeof|instanceof|in|of|try|catch|finally|throw|async|await|yield|import|export|from|default|null|undefined|true|false|void|delete|static|get|set|interface|type|enum|implements|readonly|public|private|protected|as|satisfies';

const RULES: Record<string, Rule[]> = {
  javascript: [
    { type: 'comment', re: /\/\/[^\n]*|\/\*[\s\S]*?\*\// },
    { type: 'string', re: /`(?:\\[\s\S]|[^\\`])*`|"(?:\\[\s\S]|[^\\"])*"|'(?:\\[\s\S]|[^\\'])*'/ },
    { type: 'keyword', re: new RegExp(`\\b(?:${JS_KEYWORDS})\\b`) },
    { type: 'number', re: /\b0[xX][\da-fA-F]+\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/ },
    { type: 'function', re: /\b[A-Za-z_$][\w$]*(?=\s*\()/ },
    { type: 'property', re: /(?<=\.)[A-Za-z_$][\w$]*/ },
    { type: 'operator', re: /=>|[+\-*/%=<>!&|?:^~]+/ },
    { type: 'punct', re: /[{}[\]();,.]/ },
  ],
  css: [
    { type: 'comment', re: /\/\*[\s\S]*?\*\// },
    { type: 'string', re: /"(?:\\[\s\S]|[^\\"])*"|'(?:\\[\s\S]|[^\\'])*'/ },
    { type: 'selector', re: /(?:^|[\n,])\s*[.#@:&]?[\w-]+(?:[^{;\n]*?)(?=\s*\{)/ },
    { type: 'property', re: /[-\w]+(?=\s*:)/ },
    { type: 'number', re: /#[\da-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms|deg|fr|ch)?\b/ },
    { type: 'function', re: /\b[\w-]+(?=\()/ },
    { type: 'punct', re: /[{}();,]/ },
  ],
  html: [
    { type: 'comment', re: /<!--[\s\S]*?-->/ },
    { type: 'string', re: /"(?:\\[\s\S]|[^\\"])*"|'(?:\\[\s\S]|[^\\'])*'/ },
    { type: 'tag', re: /<\/?[a-zA-Z][\w-]*|\/?>/ },
    { type: 'attr', re: /\b[a-zA-Z-]+(?==)/ },
    { type: 'punct', re: /[=]/ },
  ],
  json: [
    { type: 'property', re: /"(?:\\.|[^"\\])*"(?=\s*:)/ },
    { type: 'string', re: /"(?:\\.|[^"\\])*"/ },
    { type: 'keyword', re: /\b(?:true|false|null)\b/ },
    { type: 'number', re: /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/ },
    { type: 'punct', re: /[{}[\]:,]/ },
  ],
  markdown: [
    { type: 'keyword', re: /^#{1,6}\s.*$/m },
    { type: 'string', re: /`[^`\n]+`|```[\s\S]*?```/ },
    { type: 'function', re: /\*\*[^*\n]+\*\*|__[^_\n]+__/ },
    { type: 'comment', re: /^\s*[-*+]\s|^\s*\d+\.\s/m },
    { type: 'tag', re: /\[[^\]\n]*\]\([^)\n]*\)/ },
  ],
};

function rulesFor(language: FileLanguage): Rule[] {
  switch (language) {
    case 'javascript':
    case 'typescript':
    case 'jsx':
    case 'tsx':
      return RULES.javascript;
    case 'css':
      return RULES.css;
    case 'html':
      return RULES.html;
    case 'json':
      return RULES.json;
    case 'markdown':
      return RULES.markdown;
    default:
      return [];
  }
}

interface Token {
  type: TokenType;
  value: string;
}

function tokenize(source: string, rules: Rule[]): Token[] {
  if (!rules.length) return [{ type: 'plain', value: source }];

  // One combined regex keeps a single left-to-right pass, so earlier rules win.
  const combined = new RegExp(rules.map((r) => `(${r.re.source})`).join('|'), 'gm');
  const tokens: Token[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = combined.exec(source))) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'plain', value: source.slice(lastIndex, match.index) });
    }
    // Find which capture group matched.
    let type: TokenType = 'plain';
    for (let i = 1; i < match.length; i += 1) {
      if (match[i] !== undefined) {
        type = rules[i - 1].type;
        break;
      }
    }
    tokens.push({ type, value: match[0] });
    lastIndex = combined.lastIndex;
    if (match[0] === '') combined.lastIndex += 1; // guard against zero-width matches
  }

  if (lastIndex < source.length) {
    tokens.push({ type: 'plain', value: source.slice(lastIndex) });
  }
  return tokens;
}

/** Renders one line of source as highlighted React nodes. */
export function highlightLine(line: string, language: FileLanguage, keyPrefix: string): ReactNode[] {
  const tokens = tokenize(line, rulesFor(language));
  return tokens.map((t, i) =>
    t.type === 'plain' ? (
      <span key={`${keyPrefix}-${i}`}>{t.value}</span>
    ) : (
      <span key={`${keyPrefix}-${i}`} className={`tk tk-${t.type}`}>
        {t.value}
      </span>
    ),
  );
}

/** Highlights an entire block (used by chat code fences). */
export function highlightBlock(source: string, language: FileLanguage): ReactNode[] {
  return source.split('\n').map((line, i) => (
    <div className="hl-line" key={i}>
      {line ? highlightLine(line, language, `l${i}`) : '\u00A0'}
    </div>
  ));
}
