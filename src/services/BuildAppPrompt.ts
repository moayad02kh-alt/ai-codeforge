/**
 * BuildAppPrompt — composes a structured natural-language prompt for the
 * EXISTING coding agent from the Build App wizard's inputs.
 *
 * Pure and testable. The output is an ordinary user prompt: it flows through
 * the standard AgentOrchestrator pipeline (plan → generate → normalise →
 * validate → execute → preview), so the wizard adds zero new execution code
 * and cannot bypass any validation or security.
 */

export interface BuildAppSpec {
  /** Short project/app name. */
  name: string;
  /** What kind of app to build. */
  appType: string;
  /** Key features the user selected (free-text chips). */
  features: string[];
  /** Pages or main screens to include. */
  pages: string[];
  /** Visual style keyword (minimal, playful, corporate, dark, …). */
  style: string;
  /** Any extra free-form notes from the user. */
  notes: string;
}

const FIELD_LIMIT = 300;

function clean(value: string, max = FIELD_LIMIT): string {
  return value.replace(/[\r\n]+/g, ' ').trim().slice(0, max);
}

export function buildBuildAppPrompt(spec: BuildAppSpec): string {
  const name = clean(spec.name, 80) || 'My App';
  const appType = clean(spec.appType, 80) || 'web app';
  const style = clean(spec.style, 60) || 'clean and modern';
  const features = spec.features.map((f) => clean(f, 120)).filter(Boolean).slice(0, 10);
  const pages = spec.pages.map((p) => clean(p, 80)).filter(Boolean).slice(0, 10);
  const notes = clean(spec.notes, 600);

  const lines: string[] = [
    `Build a complete, working ${appType} called "${name}" from scratch.`,
    '',
    `Visual style: ${style}. Responsive, accessible (semantic HTML, labelled inputs, alt text) and respecting prefers-reduced-motion.`,
  ];

  if (pages.length) {
    lines.push('', `Main pages/screens to include: ${pages.join(', ')}.`);
  }
  if (features.length) {
    lines.push('', 'Required features:');
    for (const f of features) lines.push(`- ${f}`);
  }
  if (notes) {
    lines.push('', `Additional requirements: ${notes}`);
  }

  lines.push(
    '',
    'Keep it self-contained: index.html entry point plus styles and scripts, no external CDNs or assets by URL, and use the safeStorage wrapper for any persistence.',
  );

  return lines.join('\n');
}
