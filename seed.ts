/**
 * Seed data — realistic mock content so the app is never empty on first load.
 * Replace with an API fetch when a backend exists.
 */

import type { ChatMessage, Project, VersionSnapshot } from '../core/types';
import { FileManager } from '../services/FileManager';
import { uid } from '../core/utils';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const base = Date.now();

/* ------------------------------------------------------------------ */
/* Project 1 — a completed portfolio site (has real, previewable code) */
/* ------------------------------------------------------------------ */

const portfolioFiles = [
  FileManager.create(
    'index.html',
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Atelier Nord — Design Studio</title>
  <link rel="stylesheet" href="styles/main.css" />
</head>
<body>
  <header class="nav">
    <span class="logo">Atelier Nord</span>
    <nav><a href="#work">Work</a><a href="#studio">Studio</a><a href="#contact">Contact</a></nav>
  </header>

  <section class="hero">
    <p class="eyebrow">Design &amp; Engineering Studio</p>
    <h1>We build calm<br /><span>digital products</span></h1>
    <p class="lede">A small team in Oslo making software that feels considered. Strategy, interface design and front-end engineering under one roof.</p>
    <a class="btn" href="#work">See our work</a>
  </section>

  <section class="work" id="work">
    <h2>Selected work</h2>
    <div class="grid">
      <article><span class="year">2025</span><h3>Fjord Bank</h3><p>Consumer banking app redesign — 2.1M users migrated in six weeks.</p></article>
      <article><span class="year">2025</span><h3>Nordlys Health</h3><p>Clinical scheduling platform for eleven Nordic hospitals.</p></article>
      <article><span class="year">2024</span><h3>Kvist</h3><p>Sustainable furniture commerce with made-to-order configurator.</p></article>
      <article><span class="year">2024</span><h3>Terra Atlas</h3><p>Open climate data explorer with interactive mapping.</p></article>
    </div>
  </section>

  <section class="studio" id="studio">
    <h2>The studio</h2>
    <p>Eleven people. One floor of a converted warehouse. We take on four engagements a year so each one gets our full attention.</p>
    <dl class="stats">
      <div><dt>Founded</dt><dd>2016</dd></div>
      <div><dt>Projects</dt><dd>62</dd></div>
      <div><dt>Team</dt><dd>11</dd></div>
    </dl>
  </section>

  <section class="contact" id="contact">
    <h2>Start a project</h2>
    <form id="contact-form">
      <input id="cname" placeholder="Your name" aria-label="Name" />
      <input id="cmail" type="email" placeholder="Email" aria-label="Email" />
      <textarea id="cmsg" rows="4" placeholder="What are you building?" aria-label="Message"></textarea>
      <button class="btn" type="submit">Send enquiry</button>
      <p class="status" id="cstatus" role="status"></p>
    </form>
  </section>

  <footer><p>© 2026 Atelier Nord · Oslo</p></footer>
  <script src="scripts/main.js"></script>
</body>
</html>
`,
    'agent',
  ),
  FileManager.create(
    'styles/main.css',
    `:root {
  --bg: #0a0a0c;
  --card: #131317;
  --line: rgba(255,255,255,0.08);
  --text: #eceef2;
  --muted: #8b8f99;
  --accent: #7dd3fc;
  --ease: cubic-bezier(.22,1,.36,1);
}
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--text); font-family:'Inter',system-ui,-apple-system,sans-serif; line-height:1.65; -webkit-font-smoothing:antialiased; }
a { color:inherit; text-decoration:none; }
h1,h2,h3 { margin:0; letter-spacing:-0.03em; font-weight:600; }

.nav { display:flex; justify-content:space-between; align-items:center; padding:22px 40px; border-bottom:1px solid var(--line); position:sticky; top:0; background:rgba(10,10,12,.82); backdrop-filter:blur(12px); z-index:10; }
.logo { font-weight:650; font-size:17px; letter-spacing:-0.02em; }
.nav nav { display:flex; gap:26px; font-size:14px; color:var(--muted); }
.nav nav a { transition:color .2s var(--ease); }
.nav nav a:hover { color:var(--accent); }

.btn { display:inline-block; padding:13px 26px; border-radius:10px; background:var(--accent); color:#06232f; font-weight:600; font-size:14px; border:0; cursor:pointer; transition:transform .22s var(--ease), filter .22s; }
.btn:hover { transform:translateY(-2px); filter:brightness(1.08); }

.hero { padding:120px 40px 96px; max-width:920px; margin:0 auto; text-align:center; background:radial-gradient(760px 340px at 50% -10%, rgba(125,211,252,.13), transparent 70%); }
.eyebrow { color:var(--accent); font-size:12px; letter-spacing:.2em; text-transform:uppercase; margin:0 0 20px; }
.hero h1 { font-size:clamp(42px,7.5vw,74px); line-height:1.05; }
.hero h1 span { color:var(--muted); }
.lede { color:var(--muted); font-size:18px; max-width:560px; margin:24px auto 34px; }

.work, .studio, .contact { max-width:1060px; margin:0 auto; padding:80px 40px; }
h2 { font-size:clamp(28px,4vw,38px); margin-bottom:36px; }
.grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:18px; }
.grid article { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:26px; transition:transform .3s var(--ease), border-color .3s; }
.grid article:hover { transform:translateY(-4px); border-color:rgba(125,211,252,.42); }
.year { color:var(--muted); font-size:12px; letter-spacing:.1em; }
.grid h3 { font-size:19px; margin:10px 0 8px; }
.grid p { color:var(--muted); font-size:14.5px; margin:0; }

.studio p { color:var(--muted); font-size:17px; max-width:660px; }
.stats { display:flex; gap:60px; margin:40px 0 0; padding-top:32px; border-top:1px solid var(--line); }
.stats dt { color:var(--muted); font-size:12px; letter-spacing:.14em; text-transform:uppercase; }
.stats dd { margin:8px 0 0; font-size:34px; font-weight:600; letter-spacing:-0.03em; }

#contact-form { display:flex; flex-direction:column; gap:14px; max-width:520px; }
input, textarea { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:13px 16px; color:var(--text); font-family:inherit; font-size:15px; resize:vertical; }
input:focus, textarea:focus { outline:none; border-color:var(--accent); }
input.bad, textarea.bad { border-color:#ef4444; }
.status { min-height:20px; font-size:14px; color:var(--accent); margin:0; }

footer { text-align:center; padding:36px; border-top:1px solid var(--line); color:var(--muted); font-size:13px; }

@media (max-width:640px) {
  .nav { padding:16px 20px; }
  .nav nav { gap:16px; }
  .work,.studio,.contact { padding:56px 20px; }
  .hero { padding:80px 20px 64px; }
  .stats { gap:32px; }
}
`,
    'agent',
  ),
  FileManager.create(
    'scripts/main.js',
    `(function () {
  'use strict';

  var form = document.getElementById('contact-form');
  var status = document.getElementById('cstatus');

  function isEmail(v) { return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/.test(v); }

  if (form && status) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var n = document.getElementById('cname');
      var m = document.getElementById('cmail');
      var g = document.getElementById('cmsg');
      [n, m, g].forEach(function (f) { if (f) f.classList.remove('bad'); });

      var bad = [];
      if (!n.value.trim()) { bad.push('your name'); n.classList.add('bad'); }
      if (!isEmail(m.value.trim())) { bad.push('a valid email'); m.classList.add('bad'); }
      if (g.value.trim().length < 10) { bad.push('a few more details'); g.classList.add('bad'); }

      if (bad.length) {
        status.style.color = '#ef4444';
        status.textContent = 'Please add ' + bad.join(', ') + '.';
        return;
      }
      status.style.color = '';
      status.textContent = 'Thanks — we reply within two business days.';
      form.reset();
    });
  }

  var cards = document.querySelectorAll('.grid article');
  if ('IntersectionObserver' in window) {
    cards.forEach(function (c) {
      c.style.opacity = '0';
      c.style.transform = 'translateY(18px)';
      c.style.transition = 'opacity .6s ease, transform .6s ease';
    });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry, i) {
        if (!entry.isIntersecting) return;
        setTimeout(function () {
          entry.target.style.opacity = '1';
          entry.target.style.transform = 'none';
        }, i * 70);
        io.unobserve(entry.target);
      });
    }, { threshold: .15 });
    cards.forEach(function (c) { io.observe(c); });
  }
})();
`,
    'agent',
  ),
  FileManager.create(
    'tests/contact.test.js',
    `import { describe, it, expect } from 'vitest';

const isEmail = (v) => /^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/.test(v);

function validate({ name, email, message }) {
  const errors = [];
  if (!name?.trim()) errors.push('name');
  if (!isEmail(email ?? '')) errors.push('email');
  if ((message ?? '').trim().length < 10) errors.push('message');
  return { valid: errors.length === 0, errors };
}

describe('contact form validation', () => {
  it('accepts a complete enquiry', () => {
    expect(validate({ name: 'Ada', email: 'ada@studio.no', message: 'We need a new site' }).valid).toBe(true);
  });
  it('rejects an invalid email', () => {
    expect(validate({ name: 'Ada', email: 'nope', message: 'We need a new site' }).errors).toContain('email');
  });
  it('rejects a short message', () => {
    expect(validate({ name: 'Ada', email: 'ada@studio.no', message: 'hi' }).errors).toContain('message');
  });
  it('requires a name', () => {
    expect(validate({ name: '', email: 'ada@studio.no', message: 'We need a new site' }).errors).toContain('name');
  });
});
`,
    'agent',
  ),
  FileManager.create(
    'README.md',
    `# Atelier Nord

Studio site for a Oslo-based design and engineering practice.

## Stack
- Vanilla HTML/CSS/JS — no runtime dependencies
- Vite dev server
- Vitest for unit tests

## Features
- Responsive layout down to 360px
- Scroll-reveal animations
- Validated enquiry form

Scaffolded by CodeForge AI.
`,
    'agent',
  ),
];

const portfolio: Project = {
  id: 'proj_atelier',
  name: 'Atelier Nord',
  description: 'Studio portfolio site with case studies and an enquiry form.',
  template: 'static-site',
  status: 'ready',
  files: portfolioFiles,
  entryPath: 'index.html',
  createdAt: base - 6 * DAY,
  updatedAt: base - 3 * HOUR,
  icon: '◆',
};

/* ------------------------------------------------------------------ */
/* Project 2 — dashboard, in-flight                                    */
/* ------------------------------------------------------------------ */

const dashboardFiles = [
  FileManager.create(
    'index.html',
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Pulse — Revenue Dashboard</title>
  <link rel="stylesheet" href="styles/main.css" />
</head>
<body>
  <div class="app">
    <aside class="side">
      <div class="side__logo">Pulse</div>
      <nav>
        <a class="active" href="#">Overview</a>
        <a href="#">Revenue</a>
        <a href="#">Customers</a>
        <a href="#">Settings</a>
      </nav>
    </aside>
    <main class="main">
      <header class="head">
        <div><h1>Overview</h1><p>Last 30 days</p></div>
        <button class="btn" id="refresh">Refresh</button>
      </header>
      <section class="kpis" id="kpis"></section>
      <section class="panel"><h2>Revenue trend</h2><div id="chart"></div></section>
    </main>
  </div>
  <script src="scripts/main.js"></script>
</body>
</html>
`,
    'agent',
  ),
  FileManager.create(
    'styles/main.css',
    `:root { --bg:#0a0b0f; --panel:#111319; --line:rgba(255,255,255,.07); --text:#e6e8ee; --muted:#868c9b; --accent:#3b82f6; --good:#22c55e; --bad:#ef4444; }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--text); font-family:'Inter',system-ui,sans-serif; font-size:15px; }
.app { display:grid; grid-template-columns:230px 1fr; min-height:100vh; }
.side { border-right:1px solid var(--line); padding:24px 16px; background:#0c0d12; }
.side__logo { font-weight:700; font-size:18px; padding:0 12px 22px; }
.side nav { display:flex; flex-direction:column; gap:4px; }
.side a { padding:10px 12px; border-radius:8px; color:var(--muted); font-size:14px; text-decoration:none; transition:background .2s,color .2s; }
.side a:hover { background:rgba(255,255,255,.04); color:var(--text); }
.side a.active { background:rgba(59,130,246,.14); color:#93c5fd; }
.main { padding:28px 32px 60px; }
.head { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:26px; }
.head h1 { margin:0; font-size:26px; }
.head p { margin:4px 0 0; color:var(--muted); font-size:13px; }
.btn { background:var(--accent); color:#fff; border:0; padding:10px 18px; border-radius:8px; font-size:14px; cursor:pointer; transition:filter .2s,transform .2s; }
.btn:hover { filter:brightness(1.12); transform:translateY(-1px); }
.kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:16px; margin-bottom:22px; }
.kpi { background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:20px; }
.kpi__label { color:var(--muted); font-size:12.5px; text-transform:uppercase; letter-spacing:.08em; }
.kpi__value { font-size:29px; font-weight:650; margin:8px 0 6px; }
.kpi__delta { font-size:13px; }
.kpi__delta.up { color:var(--good); } .kpi__delta.down { color:var(--bad); }
.panel { background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:22px; }
.panel h2 { margin:0 0 18px; font-size:16px; font-weight:600; }
svg .line { fill:none; stroke:var(--accent); stroke-width:2.5; stroke-linecap:round; stroke-linejoin:round; }
svg .area { fill:url(#g); }
@media (max-width:820px) { .app { grid-template-columns:1fr; } .side nav { flex-direction:row; overflow-x:auto; } .main { padding:20px; } }
`,
    'agent',
  ),
  FileManager.create(
    'scripts/main.js',
    `(function () {
  'use strict';

  var KPIS = [
    { label: 'Revenue', value: '$284,120', delta: 12.4 },
    { label: 'Orders', value: '3,842', delta: 8.1 },
    { label: 'Customers', value: '1,204', delta: 4.6 },
    { label: 'Churn', value: '2.1%', delta: -0.8 }
  ];
  var TREND = [42, 51, 47, 63, 58, 72, 69, 84, 78, 92, 88, 104];

  function renderKpis() {
    document.getElementById('kpis').innerHTML = KPIS.map(function (k) {
      var dir = k.delta >= 0 ? 'up' : 'down';
      var arrow = k.delta >= 0 ? '▲' : '▼';
      return '<div class="kpi"><div class="kpi__label">' + k.label + '</div>' +
        '<div class="kpi__value">' + k.value + '</div>' +
        '<div class="kpi__delta ' + dir + '">' + arrow + ' ' + Math.abs(k.delta) + '%</div></div>';
    }).join('');
  }

  function renderChart() {
    var w = 720, h = 220, pad = 20;
    var max = Math.max.apply(null, TREND) * 1.1;
    var step = (w - pad * 2) / (TREND.length - 1);
    var pts = TREND.map(function (v, i) { return [pad + i * step, h - pad - (v / max) * (h - pad * 2)]; });
    var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    var area = line + ' L' + pts[pts.length - 1][0].toFixed(1) + ' ' + (h - pad) + ' L' + pad + ' ' + (h - pad) + ' Z';
    document.getElementById('chart').innerHTML =
      '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" height="220" preserveAspectRatio="none">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#3b82f6" stop-opacity="0.35"/>' +
      '<stop offset="100%" stop-color="#3b82f6" stop-opacity="0"/></linearGradient></defs>' +
      '<path class="area" d="' + area + '"/><path class="line" d="' + line + '"/></svg>';
  }

  var refresh = document.getElementById('refresh');
  if (refresh) refresh.addEventListener('click', function () { renderKpis(); renderChart(); });

  renderKpis();
  renderChart();
})();
`,
    'agent',
  ),
  FileManager.create(
    'tests/format.test.js',
    `import { describe, it, expect } from 'vitest';

const pct = (n) => (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
const money = (n) => '$' + n.toLocaleString('en-US');

describe('formatting helpers', () => {
  it('formats positive deltas', () => expect(pct(12.4)).toBe('+12.4%'));
  it('formats negative deltas', () => expect(pct(-0.8)).toBe('-0.8%'));
  it('formats currency', () => expect(money(284120)).toBe('$284,120'));
});
`,
    'agent',
  ),
];

const dashboard: Project = {
  id: 'proj_pulse',
  name: 'Pulse Analytics',
  description: 'Revenue dashboard with KPI cards and an SVG trend chart.',
  template: 'dashboard',
  status: 'ready',
  files: dashboardFiles,
  entryPath: 'index.html',
  createdAt: base - 2 * DAY,
  updatedAt: base - 40 * 60_000,
  icon: '▣',
};

/* ------------------------------------------------------------------ */
/* Project 3 — empty, ready for the demo prompt                        */
/* ------------------------------------------------------------------ */

const blank: Project = {
  id: 'proj_blank',
  name: 'Untitled Project',
  description: 'Empty workspace — describe what you want to build.',
  template: 'blank',
  status: 'draft',
  files: [],
  entryPath: 'index.html',
  createdAt: base - 20 * 60_000,
  updatedAt: base - 20 * 60_000,
  icon: '＋',
};

export const SEED_PROJECTS: Project[] = [portfolio, dashboard, blank];

export const SEED_MESSAGES: Record<string, ChatMessage[]> = {
  proj_atelier: [
    {
      id: uid('msg'),
      role: 'system',
      content:
        'Session started. The agent is running with the **simulated** provider — no external model is connected.',
      createdAt: base - 6 * DAY,
    },
    {
      id: uid('msg'),
      role: 'user',
      content: 'Build a portfolio site for a Nordic design studio called Atelier Nord.',
      createdAt: base - 6 * DAY + 1000,
    },
    {
      id: uid('msg'),
      role: 'agent',
      content:
        'I scaffolded **Atelier Nord** across 5 files — a responsive single-page studio site with a case-study grid, studio stats and a validated enquiry form.\n\nThe design uses a muted charcoal palette with a soft sky accent. Scroll reveals are wired through `IntersectionObserver` and degrade gracefully. A Vitest suite covers the form validation rules.',
      createdAt: base - 6 * DAY + 42_000,
    },
    {
      id: uid('msg'),
      role: 'user',
      content: 'Add the studio stats section under the about copy.',
      createdAt: base - 3 * HOUR - 60_000,
    },
    {
      id: uid('msg'),
      role: 'agent',
      content:
        'Added a three-column stats block (Founded, Projects, Team) beneath the studio copy, with a top rule to separate it from the paragraph above. It collapses to a tighter gap under 640px.\n\nThe previous version is saved in **Version History** if you want to revert.',
      createdAt: base - 3 * HOUR,
    },
  ],
  proj_pulse: [
    {
      id: uid('msg'),
      role: 'user',
      content: 'Create a revenue analytics dashboard with KPI cards and a trend chart.',
      createdAt: base - 2 * DAY,
    },
    {
      id: uid('msg'),
      role: 'agent',
      content:
        'Built **Pulse Analytics** with a fixed sidebar shell, four KPI cards showing period-over-period deltas, and a hand-rolled SVG area chart — no charting dependency.\n\nThe layout collapses to a horizontal nav strip under 820px. Data currently comes from an in-file constant; ask me to extract it into a service module when you are ready to connect an API.',
      createdAt: base - 2 * DAY + 51_000,
    },
  ],
  proj_blank: [],
};

export const SEED_VERSIONS: VersionSnapshot[] = [
  {
    id: 'ver_atelier_2',
    projectId: 'proj_atelier',
    label: 'Add studio stats block',
    description: 'Three-column stats grid beneath the studio copy.',
    origin: 'agent',
    createdAt: base - 3 * HOUR,
    files: portfolioFiles,
    changes: [
      { path: 'index.html', action: 'modified', additions: 7, deletions: 1 },
      { path: 'styles/main.css', action: 'modified', additions: 6, deletions: 0 },
    ],
  },
  {
    id: 'ver_atelier_1',
    projectId: 'proj_atelier',
    label: 'Initial scaffold',
    description: 'Generated the studio site: markup, design system, interactions and tests.',
    origin: 'agent',
    createdAt: base - 6 * DAY + 42_000,
    files: portfolioFiles,
    changes: [
      { path: 'index.html', action: 'created', additions: 48, deletions: 0 },
      { path: 'styles/main.css', action: 'created', additions: 62, deletions: 0 },
      { path: 'scripts/main.js', action: 'created', additions: 44, deletions: 0 },
      { path: 'tests/contact.test.js', action: 'created', additions: 26, deletions: 0 },
      { path: 'README.md', action: 'created', additions: 16, deletions: 0 },
    ],
  },
  {
    id: 'ver_pulse_1',
    projectId: 'proj_pulse',
    label: 'Initial scaffold',
    description: 'Dashboard shell, KPI cards, SVG chart and formatting tests.',
    origin: 'agent',
    createdAt: base - 2 * DAY + 51_000,
    files: dashboardFiles,
    changes: [
      { path: 'index.html', action: 'created', additions: 32, deletions: 0 },
      { path: 'styles/main.css', action: 'created', additions: 40, deletions: 0 },
      { path: 'scripts/main.js', action: 'created', additions: 46, deletions: 0 },
      { path: 'tests/format.test.js', action: 'created', additions: 9, deletions: 0 },
    ],
  },
];

export const EXAMPLE_PROMPTS = [
  'Build me a luxury restaurant website',
  'Create a SaaS landing page with pricing tiers',
  'Build an analytics dashboard with charts',
  'Make a portfolio site for a photographer',
];
