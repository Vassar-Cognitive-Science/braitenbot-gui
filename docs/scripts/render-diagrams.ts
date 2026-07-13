/**
 * Render every embedded `<InteractiveDiagram>` in the docs to a static SVG
 * gallery, so diagram layouts can be reviewed at a glance (line/weight
 * overlaps, node placement, top-down flow) without running the docs site.
 *
 * This replays the app's *real* render geometry (`computeConnectionPaths`,
 * `weightToColor`, `NODE_W/H`) over each authored diagram literal — the same
 * math the badge-overlap checker uses — so what you see here matches the
 * embed's static (non-trace) wiring view.
 *
 * Usage (from the repo root):
 *   npx tsx docs/scripts/render-diagrams.ts            # → docs/scripts/out/diagram-gallery.html
 *   npx tsx docs/scripts/render-diagrams.ts --out FILE
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import {
  NODE_H,
  NODE_W,
  computeConnectionPaths,
  nodeRenderHeight,
  weightToColor,
} from '../../src/components/connectionGeometry';
import { TYPE_BY_ID } from '../../src/types/diagram';
import type { DiagramNode, NodeKind } from '../../src/types/diagram';
import {
  type EmbeddedDiagram,
  extractDiagrams,
  frontmatterTitle,
  mdxFiles,
} from './diagramExtract';

const DOCS_DIR = join(import.meta.dirname, '..', 'docs');
const REPO_ROOT = join(import.meta.dirname, '..', '..');
const outArgIdx = process.argv.indexOf('--out');
const OUT_FILE =
  outArgIdx !== -1 && process.argv[outArgIdx + 1]
    ? process.argv[outArgIdx + 1]
    : join(import.meta.dirname, 'out', 'diagram-gallery.html');

const PAD = 44;
const KIND_COLOR: Record<NodeKind, string> = {
  sensor: '#e0863b',
  compute: '#4c8fd6',
  output: '#46b37a',
  constant: '#c9a227',
  compound: '#9b72d0',
  port: '#8892a0',
};

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function isWheel(n: DiagramNode): boolean {
  return n.type === 'servo-cr' && (n.id === 'motor-left' || n.id === 'motor-right' || /wheel/i.test(n.label));
}

/** Short parameter hint under a node label (mirrors the app's node-meta line). */
function metaHint(n: DiagramNode): string {
  const def = TYPE_BY_ID[n.type];
  if (n.type === 'compute-threshold') {
    const op = (n as { thresholdOp?: string }).thresholdOp ?? '>';
    return `input ${op} ${n.threshold ?? 50}`;
  }
  if (n.type === 'constant') return `= ${n.constantValue ?? 0}`;
  if (n.type === 'compute-delay') return `delay ${n.delayMs ?? 0}ms`;
  return def.metaLabel;
}

function renderSvg(d: EmbeddedDiagram): string {
  const byId = (id: string) => d.nodes.find((n) => n.id === id);
  const pos = (n: DiagramNode) => ({ x: n.x, y: n.y });
  const paths = computeConnectionPaths(d.connections, byId, pos, d.compoundTypes, 1, false);

  // Bounds over nodes + badges.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of d.nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + NODE_W);
    maxY = Math.max(maxY, n.y + nodeRenderHeight(n, false));
  }
  for (const p of paths) {
    minX = Math.min(minX, p.midX - 28);
    maxX = Math.max(maxX, p.midX + 28);
    minY = Math.min(minY, p.midY - 12);
    maxY = Math.max(maxY, p.midY + 12);
  }
  const vx = minX - PAD, vy = minY - PAD;
  const vw = maxX - minX + PAD * 2, vh = maxY - minY + PAD * 2;

  const parts: string[] = [];
  parts.push(
    `<svg viewBox="${vx} ${vy} ${vw} ${vh}" width="${Math.min(vw, 640)}" xmlns="http://www.w3.org/2000/svg" font-family="ui-sans-serif, system-ui, sans-serif">`,
  );

  // Faint chassis hint behind wheel nodes (previews the app's robot overlay).
  const wheels = d.nodes.filter(isWheel);
  if (wheels.length >= 2) {
    const cx = wheels.reduce((s, n) => s + n.x + NODE_W / 2, 0) / wheels.length;
    const cy = wheels.reduce((s, n) => s + n.y + NODE_H / 2, 0) / wheels.length;
    const spread = Math.max(...wheels.map((n) => Math.abs(n.x + NODE_W / 2 - cx)));
    parts.push(
      `<ellipse cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" rx="${(spread + NODE_W * 0.7).toFixed(0)}" ry="${(NODE_H * 1.3).toFixed(0)}" fill="none" stroke="#3a4150" stroke-width="1.5" stroke-dasharray="4 4"/>`,
    );
  }

  // Connections.
  for (const p of paths) {
    const color = weightToColor(p.weight);
    const dash = p.transferMode === 'nonlinear' ? ' stroke-dasharray="6 4"' : '';
    parts.push(`<path d="${p.d}" fill="none" stroke="${color}" stroke-width="2.4"${dash} opacity="0.9"/>`);
  }
  // Weight badges (drawn above wires).
  for (const p of paths) {
    const label = p.transferMode === 'nonlinear' ? '∿ curve' : `w ${p.weight.toFixed(2)}`;
    const bw = label.length * 6.2 + 12;
    parts.push(
      `<g transform="translate(${p.midX.toFixed(1)}, ${p.midY.toFixed(1)})">` +
        `<rect x="${(-bw / 2).toFixed(1)}" y="-9" width="${bw.toFixed(1)}" height="18" rx="9" fill="#161a22" stroke="${weightToColor(p.weight)}" stroke-width="1.2"/>` +
        `<text x="0" y="4" text-anchor="middle" font-size="11" fill="#d7dbe2">${esc(label)}</text>` +
        `</g>`,
    );
  }

  // Nodes.
  for (const n of d.nodes) {
    const def = TYPE_BY_ID[n.type];
    const color = KIND_COLOR[def.kind];
    const h = nodeRenderHeight(n, false);
    parts.push(
      `<g transform="translate(${n.x}, ${n.y})">` +
        `<rect width="${NODE_W}" height="${h}" rx="10" fill="#1c212b" stroke="${color}" stroke-width="1.8"/>` +
        `<rect width="4" height="${h}" rx="2" fill="${color}"/>` +
        `<text x="12" y="26" font-size="14" font-weight="600" fill="#eef1f5">${esc(n.label)}</text>` +
        `<text x="12" y="45" font-size="11" fill="#98a0ad">${esc(metaHint(n))}</text>` +
        `</g>`,
    );
  }

  parts.push('</svg>');
  return parts.join('');
}

interface Card {
  file: string;
  pageTitle: string;
  d: EmbeddedDiagram;
  index: number;
}

const cards: Card[] = [];
for (const file of mdxFiles(DOCS_DIR)) {
  const src = readFileSync(file, 'utf8');
  if (!src.includes('<InteractiveDiagram')) continue;
  const rel = relative(REPO_ROOT, file).replace(/\\/g, '/');
  const pageTitle = frontmatterTitle(src) ?? rel;
  extractDiagrams(src).forEach((d, i) => cards.push({ file: rel, pageTitle, d, index: i }));
}

// Group cards by page, preserving file order.
const byPage = new Map<string, Card[]>();
for (const c of cards) {
  const list = byPage.get(c.file);
  if (list) list.push(c);
  else byPage.set(c.file, [c]);
}

const sections: string[] = [];
for (const [file, list] of byPage) {
  const cardHtml = list
    .map((c) => {
      const { d } = c;
      const tag = d.goalTitle ? 'Puzzle' : d.traceMode ? 'Live' : 'Static';
      const heading = d.heading ? esc(d.heading) : `Diagram ${c.index + 1}`;
      const goal = d.goalTitle ? `<p class="goal"><b>Goal:</b> ${esc(d.goalTitle)}</p>` : '';
      const cap = d.caption ? `<p class="cap">${esc(d.caption)}</p>` : '';
      return (
        `<div class="card">` +
        `<div class="card-head"><span class="tag tag-${tag.toLowerCase()}">${tag}</span>` +
        `<span class="hd">${heading}</span><span class="loc">${esc(c.file)}:${d.line}</span></div>` +
        goal +
        `<div class="svg-wrap">${renderSvg(d)}</div>` +
        cap +
        `</div>`
      );
    })
    .join('\n');
  sections.push(
    `<section><h2>${esc(list[0].pageTitle)} <span class="path">${esc(file)}</span></h2>${cardHtml}</section>`,
  );
}

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>BraitenBot diagram gallery</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #0e1116; color: #e6e9ef; font: 15px/1.5 ui-sans-serif, system-ui, sans-serif; }
  header { padding: 24px 28px; border-bottom: 1px solid #232a35; position: sticky; top: 0; background: #0e1116; z-index: 2; }
  header h1 { margin: 0 0 4px; font-size: 20px; }
  header p { margin: 0; color: #98a0ad; }
  main { padding: 16px 28px 60px; }
  section { margin: 28px 0; }
  section h2 { font-size: 17px; border-bottom: 1px solid #232a35; padding-bottom: 6px; }
  section h2 .path { color: #6b7482; font-weight: 400; font-size: 12px; margin-left: 8px; }
  .grid, main { }
  .card { display: inline-block; vertical-align: top; width: 660px; max-width: 100%; margin: 0 18px 26px 0; background: #131820; border: 1px solid #232a35; border-radius: 12px; padding: 14px 16px; }
  .card-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; flex-wrap: wrap; }
  .card-head .hd { font-weight: 600; }
  .card-head .loc { color: #6b7482; font-size: 12px; margin-left: auto; }
  .tag { font-size: 11px; padding: 2px 8px; border-radius: 999px; font-weight: 600; }
  .tag-puzzle { background: #3a2e12; color: #e0b24a; }
  .tag-live { background: #123024; color: #63c795; }
  .tag-static { background: #1d2430; color: #8fa0b5; }
  .goal { margin: 4px 0 8px; color: #d7c48a; font-size: 13px; }
  .cap { margin: 8px 0 0; color: #98a0ad; font-size: 13px; font-style: italic; }
  .svg-wrap { background: #0e1116; border-radius: 8px; padding: 10px; overflow-x: auto; }
  svg { max-width: 100%; height: auto; display: block; }
</style></head>
<body>
<header><h1>BraitenBot embedded-diagram gallery</h1>
<p>${cards.length} diagrams across ${byPage.size} pages · static (non-trace) wiring view · dashed = nonlinear transfer curve · faint ellipse = robot chassis preview</p></header>
<main>${sections.join('\n')}</main>
</body></html>`;

mkdirSync(dirname(OUT_FILE), { recursive: true });
writeFileSync(OUT_FILE, html);
console.log(`Rendered ${cards.length} diagrams across ${byPage.size} pages → ${relative(REPO_ROOT, OUT_FILE).replace(/\\/g, '/')}`);
