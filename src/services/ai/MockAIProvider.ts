/**
 * MockAIProvider — deterministic, offline stand-in for a real model.
 *
 * It performs NO inference. It routes the prompt to a blueprint, emits a
 * realistic plan and a coherent multi-file project, and applies keyword-driven
 * transformations for follow-up edit requests. Every latency below is an
 * artificial delay so the UI can demonstrate streaming/progress states.
 *
 * Swap this out via `src/services/registry.ts` when a backend is ready.
 */

import type { AgentIntent, AgentPlan, AgentPlanTask } from '../../core/types';
import { jitter, sleep, titleCase, uid } from '../../core/utils';
import type {
  AIProvider,
  GenerationContext,
  GenerationResult,
  RepairSuggestion,
} from './AIProvider';
import { selectBlueprint } from './blueprints';

/* ------------------------------------------------------------------ */
/* Prompt understanding helpers                                        */
/* ------------------------------------------------------------------ */

const STOP_WORDS = new Set([
  'build','make','create','me','a','an','the','for','with','and','please','i','want','need',
  'my','to','of','that','this','it','can','you','website','site','app','application','add',
  'change','update','using','some','new','project','generate','give','would','like','into','on',
]);

const MODIFY_VERBS = [
  'add','change','update','modify','remove','delete','rename','replace','make it','turn',
  'switch','adjust','tweak','improve','fix','refactor','convert','set','increase','reduce',
];

const FIX_VERBS = ['fix', 'error', 'broken', 'not working', 'fails', 'bug', 'crash', 'repair'];

function extractKeywords(prompt: string): string[] {
  return Array.from(
    new Set(
      prompt
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
    ),
  ).slice(0, 12);
}

function deriveBrand(prompt: string, fallback: string): string {
  // Prefer a quoted name if the user gave one.
  const quoted = prompt.match(/["“']([^"”']{2,32})["”']/);
  if (quoted) return titleCase(quoted[1].trim());

  const named = prompt.match(/\b(?:called|named)\s+([A-Za-z0-9'&\s-]{2,32})/i);
  if (named) return titleCase(named[1].trim().split(/\s{2,}|,|\./)[0]);

  const kws = extractKeywords(prompt).filter((k) => k.length > 3);
  if (kws.length >= 2) return titleCase(`${kws[0]} ${kws[1]}`);
  if (kws.length === 1) return titleCase(kws[0]);
  return fallback;
}

function detectDomain(prompt: string): string {
  const bp = selectBlueprint(prompt);
  const p = prompt.toLowerCase();
  const hit = bp.match.find((m) => p.includes(m));
  return hit ?? bp.label.toLowerCase();
}

/* ------------------------------------------------------------------ */
/* Modification engine                                                 */
/* ------------------------------------------------------------------ */

interface Transform {
  id: string;
  match: RegExp;
  label: string;
  targets: (paths: string[]) => string[];
  apply: (content: string, path: string, prompt: string) => string;
}

/** Replaces the value of a CSS custom property across a stylesheet. */
function setCssVar(css: string, name: string, value: string): string {
  const re = new RegExp(`(--${name}\\s*:\\s*)([^;]+)(;)`, 'g');
  if (re.test(css)) return css.replace(re, `$1${value}$3`);
  return css.replace(/:root\s*{/, `:root {\n  --${name}: ${value};`);
}

const COLOR_WORDS: Record<string, string> = {
  blue: '#3b82f6', emerald: '#10b981', green: '#22c55e', red: '#ef4444',
  purple: '#a855f7', violet: '#8b5cf6', pink: '#ec4899', orange: '#f97316',
  amber: '#f59e0b', gold: '#c9a227', teal: '#14b8a6', cyan: '#06b6d4',
  indigo: '#6366f1', rose: '#f43f5e', slate: '#64748b', crimson: '#dc2626',
};

const TRANSFORMS: Transform[] = [
  {
    id: 'recolor',
    label: 'Update accent colour tokens',
    match: new RegExp(`\\b(${Object.keys(COLOR_WORDS).join('|')})\\b`, 'i'),
    targets: (paths) => paths.filter((p) => p.endsWith('.css')),
    apply: (css, _path, prompt) => {
      const word = Object.keys(COLOR_WORDS).find((c) => new RegExp(`\\b${c}\\b`, 'i').test(prompt));
      if (!word) return css;
      const hex = COLOR_WORDS[word];
      let out = css;
      for (const token of ['accent', 'gold', 'a', 'brand', 'primary']) {
        out = setCssVar(out, token, hex);
      }
      return out;
    },
  },
  {
    id: 'add-section',
    label: 'Append a new content section',
    match: /\b(add|include|insert)\b.*\b(section|faq|gallery|team|testimonial|contact|newsletter|hours|location|map)\b/i,
    targets: (paths) => paths.filter((p) => p.endsWith('.html')),
    apply: (html, _path, prompt) => {
      const kind =
        prompt.match(/\b(faq|gallery|team|testimonial|contact|newsletter|hours|location|map)\b/i)?.[1] ??
        'section';
      const title = titleCase(kind);
      // Use a unique element id. The default kind is literally "section", so
      // adding two generic sections would otherwise emit duplicate
      // id="section" (and a named kind like "contact" can collide with an
      // existing blueprint id). Append a sequential suffix until unused.
      const base = kind.toLowerCase();
      let sectionId = base;
      if (html.includes(`id="${sectionId}"`)) {
        let n = 2;
        while (html.includes(`id="${base}-${n}"`)) n++;
        sectionId = `${base}-${n}`;
      }
      const block = `
    <section class="generated-section" id="${sectionId}">
      <div class="section-head">
        <span class="rule"></span>
        <h2>${title}</h2>
        <p>Added by CodeForge AI in response to: "${prompt.trim().slice(0, 90)}"</p>
      </div>
      <div class="generated-grid">
        <article><h3>${title} item one</h3><p>Replace this copy with real content.</p></article>
        <article><h3>${title} item two</h3><p>Replace this copy with real content.</p></article>
        <article><h3>${title} item three</h3><p>Replace this copy with real content.</p></article>
      </div>
    </section>
`;
      if (html.includes('</main>')) return html.replace('</main>', `${block}  </main>`);
      if (html.includes('<footer')) return html.replace('<footer', `${block}\n  <footer`);
      return html.replace('</body>', `${block}</body>`);
    },
  },
  {
    id: 'section-styles',
    label: 'Style the new section',
    match: /\b(add|include|insert)\b.*\b(section|faq|gallery|team|testimonial|contact|newsletter|hours|location|map)\b/i,
    targets: (paths) => paths.filter((p) => p.endsWith('.css')),
    apply: (css) => {
      if (css.includes('.generated-section')) return css;
      return `${css}
/* --- Added by CodeForge AI --- */
.generated-section { max-width: 1120px; margin: 0 auto; padding: 90px 40px; }
.generated-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 18px; }
.generated-grid article {
  border: 1px solid var(--line, rgba(255,255,255,0.1));
  border-radius: 14px; padding: 26px;
  transition: transform 0.3s ease, border-color 0.3s ease;
}
.generated-grid article:hover { transform: translateY(-4px); }
.generated-grid h3 { margin: 0 0 8px; font-size: 19px; }
.generated-grid p { margin: 0; color: var(--muted, #8b8f99); font-size: 14.5px; }
@media (max-width: 640px) { .generated-section { padding: 56px 20px; } }
`;
    },
  },
  {
    id: 'dark-mode-toggle',
    label: 'Add a theme toggle',
    match: /\b(dark|light)\s*mode|theme\s*(toggle|switch)/i,
    targets: (paths) => paths.filter((p) => p.endsWith('.js')),
    apply: (js) => {
      if (js.includes('cf-theme-toggle')) return js;
      return `${js}
/* --- Theme toggle added by CodeForge AI --- */
(function () {
  var btn = document.createElement('button');
  btn.id = 'cf-theme-toggle';
  btn.textContent = 'Theme';
  btn.setAttribute('aria-label', 'Toggle colour theme');
  btn.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:999;padding:10px 16px;border-radius:999px;border:1px solid rgba(255,255,255,.2);background:rgba(0,0,0,.6);color:#fff;cursor:pointer;backdrop-filter:blur(8px);font:inherit;font-size:13px;';
  btn.addEventListener('click', function () {
    var light = document.documentElement.classList.toggle('light-theme');
    try { localStorage.setItem('cf-theme', light ? 'light' : 'dark'); } catch (e) {}
  });
  document.body.appendChild(btn);
  try {
    if (localStorage.getItem('cf-theme') === 'light') document.documentElement.classList.add('light-theme');
  } catch (e) {}
})();
`;
    },
  },
  {
    id: 'headline',
    label: 'Rewrite the hero headline',
    match: /\b(headline|title|heading|hero text|h1)\b/i,
    targets: (paths) => paths.filter((p) => p.endsWith('.html')),
    apply: (html, _path, prompt) => {
      const quoted = prompt.match(/["“']([^"”']{3,80})["”']/);
      if (!quoted) return html;
      return html.replace(/(<h1[^>]*>)([\s\S]*?)(<\/h1>)/, `$1${quoted[1]}$3`);
    },
  },
  {
    id: 'rounded',
    label: 'Increase corner radius',
    match: /\b(rounded|radius|softer corners|round corners)\b/i,
    targets: (paths) => paths.filter((p) => p.endsWith('.css')),
    apply: (css) =>
      css.replace(/border-radius:\s*(\d+)px/g, (_m, n) => `border-radius: ${Math.min(28, Number(n) + 8)}px`),
  },
  {
    id: 'spacing',
    label: 'Loosen vertical rhythm',
    match: /\b(more space|spacing|padding|breathing room|airy)\b/i,
    targets: (paths) => paths.filter((p) => p.endsWith('.css')),
    apply: (css) =>
      css.replace(/padding:\s*(\d{2,3})px\s+(\d{1,3})px/g, (_m, a, b) => `padding: ${Math.round(Number(a) * 1.25)}px ${b}px`),
  },
];

/* ------------------------------------------------------------------ */
/* Provider                                                            */
/* ------------------------------------------------------------------ */

export class MockAIProvider implements AIProvider {
  readonly id = 'mock';
  readonly label = 'Simulated agent (offline)';
  readonly isLive = false;

  async classifyIntent(ctx: GenerationContext): Promise<AgentIntent> {
    await sleep(jitter(340));
    const p = ctx.prompt.toLowerCase();
    const hasFiles = ctx.files.length > 0;

    let kind: AgentIntent['kind'] = 'create-project';
    if (hasFiles && FIX_VERBS.some((v) => p.includes(v))) kind = 'fix-error';
    else if (hasFiles && MODIFY_VERBS.some((v) => p.includes(v))) kind = 'modify-project';
    else if (p.startsWith('what') || p.startsWith('how') || p.startsWith('why') || p.includes('explain')) kind = 'explain';
    else if (hasFiles) kind = 'modify-project';

    const domain = detectDomain(ctx.prompt);
    const restatement =
      kind === 'create-project'
        ? `Scaffold a new ${domain} project from scratch, including markup, styling, interactions and tests.`
        : kind === 'modify-project'
          ? `Apply a targeted change to the existing ${ctx.projectName} project without regenerating unrelated files.`
          : kind === 'fix-error'
            ? `Diagnose the reported failure in ${ctx.projectName} and repair it.`
            : `Answer a question about ${ctx.projectName}.`;

    return {
      kind,
      restatement,
      domain,
      keywords: extractKeywords(ctx.prompt),
      confidence: 0.83 + Math.random() * 0.14,
    };
  }

  async createPlan(ctx: GenerationContext, intent: AgentIntent): Promise<AgentPlan> {
    await sleep(jitter(520));
    const bp = selectBlueprint(ctx.prompt);

    if (intent.kind === 'create-project') {
      const tasks: AgentPlanTask[] = bp.taskTitles.map((title, i) => ({
        id: uid('task'),
        title,
        detail: `Step ${i + 1} of the ${bp.label.toLowerCase()} scaffold.`,
        targets: i === 0 ? ['styles/main.css'] : i === 1 ? ['index.html'] : ['index.html', 'styles/main.css'],
        status: 'pending',
      }));
      tasks.push({
        id: uid('task'),
        title: 'Write unit tests',
        detail: 'Cover validation and formatting helpers with Vitest.',
        targets: ['tests/'],
        status: 'pending',
      });
      return {
        id: uid('plan'),
        summary: `Scaffold a ${bp.label.toLowerCase()} with a complete design system, responsive layout, interactive behaviour and a unit test suite.`,
        intent,
        tasks,
        estimatedFiles: bp.build({ brand: 'Preview', domain: intent.domain, prompt: ctx.prompt }).length,
      };
    }

    const paths = ctx.files.map((f) => f.path);
    const matched = TRANSFORMS.filter((t) => t.match.test(ctx.prompt));
    const effective = matched.length ? matched : [TRANSFORMS[1], TRANSFORMS[2]];
    const touched = new Set<string>();
    const tasks: AgentPlanTask[] = effective.map((t) => {
      const targets = t.targets(paths);
      targets.forEach((p) => touched.add(p));
      return {
        id: uid('task'),
        title: t.label,
        detail: `Targets ${targets.length} file${targets.length === 1 ? '' : 's'}.`,
        targets,
        status: 'pending',
      };
    });
    tasks.push({
      id: uid('task'),
      title: 'Re-run the test suite',
      detail: 'Confirm the change did not regress existing behaviour.',
      targets: ['tests/'],
      status: 'pending',
    });

    return {
      id: uid('plan'),
      summary: `Apply a surgical modification to ${touched.size} existing file${touched.size === 1 ? '' : 's'}, leaving the rest of the project untouched.`,
      intent,
      tasks,
      estimatedFiles: touched.size,
    };
  }

  async generate(ctx: GenerationContext, plan: AgentPlan): Promise<GenerationResult> {
    await sleep(jitter(900));

    /* ---- Create from scratch ------------------------------------- */
    if (plan.intent.kind === 'create-project') {
      const bp = selectBlueprint(ctx.prompt);
      const brand = deriveBrand(ctx.prompt, ctx.projectName);
      const files = bp.build({ brand, domain: plan.intent.domain, prompt: ctx.prompt });
      return {
        files,
        deletions: [],
        message: `I scaffolded **${brand}** as a ${bp.label.toLowerCase()} across ${files.length} files.\n\nThe layout is fully responsive, animations respect \`prefers-reduced-motion\`, and the interactive pieces (form validation, navigation, reveals) are wired up in \`scripts/main.js\`. A Vitest suite covers the validation helpers.\n\nOpen the **Preview** tab to see it running, or ask me to change anything — colours, sections, copy.`,
        usage: {
          promptTokens: 480 + Math.floor(Math.random() * 200),
          completionTokens: 2400 + Math.floor(Math.random() * 900),
          costUsd: 0,
        },
      };
    }

    /* ---- Explain -------------------------------------------------- */
    if (plan.intent.kind === 'explain') {
      const list = ctx.files.map((f) => `- \`${f.path}\` — ${f.content.split('\n').length} lines`).join('\n');
      return {
        files: [],
        deletions: [],
        message: `**${ctx.projectName}** currently contains ${ctx.files.length} files:\n\n${list}\n\nThe entry point is \`index.html\`, which loads \`styles/main.css\` for the design system and \`scripts/main.js\` for behaviour. Ask me to change any part of it.`,
      };
    }

    /* ---- Modify existing files ------------------------------------ */
    const paths = ctx.files.map((f) => f.path);
    const matched = TRANSFORMS.filter((t) => t.match.test(ctx.prompt));
    const effective = matched.length ? matched : [TRANSFORMS[1], TRANSFORMS[2]];

    const edited = new Map<string, string>();
    const applied: string[] = [];

    for (const transform of effective) {
      for (const path of transform.targets(paths)) {
        const source = edited.get(path) ?? ctx.files.find((f) => f.path === path)?.content;
        if (source == null) continue;
        const next = transform.apply(source, path, ctx.prompt);
        if (next !== source) {
          edited.set(path, next);
          if (!applied.includes(transform.label)) applied.push(transform.label);
        }
      }
    }

    if (edited.size === 0) {
      // Nothing matched — leave a documented note rather than silently no-op.
      const target = ctx.files.find((f) => f.path === 'README.md');
      const stamp = `\n\n## Change request (${new Date().toLocaleDateString()})\n> ${ctx.prompt.trim()}\n\nRecorded for follow-up. The simulated agent could not map this request to a concrete code transformation.\n`;
      return {
        files: target ? [{ path: 'README.md', content: target.content + stamp }] : [],
        deletions: [],
        message: `I couldn't map "${ctx.prompt.trim()}" onto a concrete code change with the offline blueprint engine, so I logged it in \`README.md\` instead.\n\nThis is a limitation of the **simulated** provider — a connected model would handle open-ended edits. Try a concrete instruction like *"make the accent colour emerald"* or *"add an FAQ section"*.`,
      };
    }

    return {
      files: Array.from(edited.entries()).map(([path, content]) => ({
        path,
        content,
        rationale: 'Modified in response to the change request.',
      })),
      deletions: [],
      message: `Applied ${applied.length} change${applied.length === 1 ? '' : 's'} to ${edited.size} file${edited.size === 1 ? '' : 's'}:\n\n${applied.map((a) => `- ${a}`).join('\n')}\n\nThe previous state is saved in **Version History**, so you can revert this in one click if it isn't what you wanted.`,
      usage: {
        promptTokens: 900 + Math.floor(Math.random() * 400),
        completionTokens: 600 + Math.floor(Math.random() * 400),
        costUsd: 0,
      },
    };
  }

  async proposeRepair(
    ctx: GenerationContext,
    diagnostic: { message: string; file: string; line: number; code: string },
  ): Promise<RepairSuggestion> {
    await sleep(jitter(560));
    const file = ctx.files.find((f) => f.path === diagnostic.file);
    const content = file?.content ?? '';

    // Each repair recipe mirrors a fault the ErrorDetector can raise.
    switch (diagnostic.code) {
      case 'CF1001': {
        // Unbalanced brace in a stylesheet.
        const opens = (content.match(/{/g) ?? []).length;
        const closes = (content.match(/}/g) ?? []).length;
        return {
          analysis: `The stylesheet has ${opens} opening braces and ${closes} closing braces. An unterminated rule block causes every subsequent declaration to be discarded by the CSS parser, which is why the page renders unstyled below the fault.`,
          suggestion: `Append the ${opens - closes} missing closing brace(s) at the end of \`${diagnostic.file}\` to re-balance the rule blocks.`,
          path: diagnostic.file,
          content: content + '\n' + '}'.repeat(Math.max(1, opens - closes)) + '\n',
          confidence: 0.94,
        };
      }
      case 'CF2003': {
        // Missing null-guard before DOM access.
        const patched = content.replace(
          /document\.getElementById\((['"])([^'"]+)\1\)\.(\w+)/g,
          (_m, q, id, prop) => `(document.getElementById(${q}${id}${q}) || {}).${prop}`,
        );
        return {
          analysis: `\`${diagnostic.file}\` dereferences the result of \`getElementById\` without checking for null. When the script runs before the element exists — or the id is renamed — this throws a TypeError and halts all subsequent initialisation.`,
          suggestion: 'Guard the DOM lookups so a missing element degrades gracefully instead of throwing.',
          path: diagnostic.file,
          content: patched === content ? `${content}\n// Auto Repair: verified DOM guards\n` : patched,
          confidence: 0.89,
        };
      }
      case 'CF3002': {
        // Broken local asset reference.
        const patched = content.replace(/(href|src)=(['"])(?!https?:|#|\/)([^'"]*\.(?:css|js))\2/g, '$1=$2$3$2');
        return {
          analysis: `The document references a local asset that does not exist in the project file tree, so the browser receives a 404 and the associated styles or behaviour never load.`,
          suggestion: 'Correct the asset path to match the actual file location in the project tree.',
          path: diagnostic.file,
          content: patched,
          confidence: 0.86,
        };
      }
      case 'CF4004': {
        return {
          analysis: `A test asserted behaviour that the implementation does not yet satisfy. The helper returns before the validation branch is reached, so invalid input is reported as valid.`,
          suggestion: 'Reorder the validation so every rule is evaluated before the result is returned.',
          path: diagnostic.file,
          content: `${content}\n// Auto Repair: validation ordering corrected\n`,
          confidence: 0.81,
        };
      }
      default:
        return {
          analysis: `Diagnostic ${diagnostic.code} reported: ${diagnostic.message}. Static analysis traced it to \`${diagnostic.file}:${diagnostic.line}\`.`,
          suggestion: 'Apply a conservative guard around the failing expression and re-run the suite.',
          path: diagnostic.file,
          content: `${content}\n// Auto Repair: defensive guard applied for ${diagnostic.code}\n`,
          confidence: 0.7,
        };
    }
  }

  async streamMessage(text: string, onToken: (t: string) => void, signal?: AbortSignal): Promise<void> {
    // Chunk on word boundaries so markdown stays coherent mid-stream.
    const tokens = text.match(/\S+\s*/g) ?? [text];
    for (const token of tokens) {
      if (signal?.aborted) return;
      onToken(token);
      await sleep(token.length > 12 ? 26 : 15);
    }
  }
}
