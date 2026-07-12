/**
 * Check (and optionally fix) connection weight-badge placement in the docs'
 * embedded diagrams.
 *
 * A connection's weight badge sits on its bézier path at parameter t
 * (`labelT`, default 0.5 / staggered for parallel edges). On long wires the
 * default midpoint can land on top of an unrelated node. This script replays
 * the app's exact render geometry (`computeConnectionPaths`) over every
 * `<InteractiveDiagram diagram={{...}}>` literal in docs/docs/**.mdx and
 * reports badges that intersect a node box. With --fix it slides each
 * offending badge to the nearest clear t along its own path and writes an
 * explicit `labelT` back into the MDX.
 *
 * Badges are checked in BOTH trace and non-trace geometry (readers can toggle
 * trace, which grows sensor nodes downward and shifts wire start anchors), and
 * a fix must clear nodes in both modes.
 *
 * Usage (from the repo root):
 *   npx tsx docs/scripts/check-badge-overlaps.ts          # report only
 *   npx tsx docs/scripts/check-badge-overlaps.ts --fix    # rewrite MDX
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  NODE_W,
  bezierPointAt,
  computeConnectionPaths,
  nearestTOnCurve,
  nodeRenderHeight,
} from '../../src/components/connectionGeometry';
import type {
  CompoundTypeDefinition,
  DiagramConnection,
  DiagramNode,
} from '../../src/types/diagram';

const DOCS_DIR = join(import.meta.dirname, '..', 'docs');
const REPO_ROOT = join(import.meta.dirname, '..', '..');
const FIX = process.argv.includes('--fix');

/** Badge footprint (px, canvas space): the `w 1.00` pill is ~52×22; MARGIN
 *  adds breathing room so a "fixed" badge doesn't kiss a node border. */
const BADGE_W = 52;
const BADGE_H = 22;
const MARGIN = 6;

/** Minimum penetration (px, both axes) before an overlap counts as "on top
 *  of" a node. Short wires in tight channels produce few-pixel edge kisses
 *  with their own endpoints that read fine on screen — don't churn those. */
const MIN_DEPTH = 8;

interface Rect { x: number; y: number; w: number; h: number }

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Penetration depth of two rects: the smaller axis of the intersection
 *  rectangle, 0 when disjoint. */
function overlapDepth(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? Math.min(w, h) : 0;
}

function badgeRect(cx: number, cy: number, margin = MARGIN): Rect {
  return {
    x: cx - BADGE_W / 2 - margin,
    y: cy - BADGE_H / 2 - margin,
    w: BADGE_W + margin * 2,
    h: BADGE_H + margin * 2,
  };
}

// ── MDX scanning ────────────────────────────────────────────────────────────

/** Scan forward from `start` (an opening brace) to its balanced close,
 *  honouring string literals so quotes/braces inside captions don't derail
 *  the depth count. Returns the index AFTER the closing brace. */
function scanBalanced(src: string, start: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return i + 1;
  }
  throw new Error(`Unbalanced braces from offset ${start}`);
}

interface EmbeddedDiagram {
  /** Absolute char offset of the diagram object literal in the file. */
  blockStart: number;
  blockEnd: number;
  line: number;
  traceMode: boolean;
  nodes: DiagramNode[];
  connections: DiagramConnection[];
  compoundTypes: CompoundTypeDefinition[];
}

function extractDiagrams(src: string): EmbeddedDiagram[] {
  const out: EmbeddedDiagram[] = [];
  const OPEN = '<InteractiveDiagram';
  let from = 0;
  for (;;) {
    const elStart = src.indexOf(OPEN, from);
    if (elStart === -1) break;
    const attrStart = elStart + OPEN.length;
    const diagAt = src.indexOf('diagram={', attrStart);
    if (diagAt === -1) break;
    // The JSX expression brace wraps the object literal: diagram={{ ... }}.
    const exprStart = diagAt + 'diagram='.length;
    const exprEnd = scanBalanced(src, exprStart);
    const blockStart = exprStart + 1;
    const blockEnd = exprEnd - 1;
    const literal = src.slice(blockStart, blockEnd);
    // The element's full text (through the closing "/>") for prop sniffing;
    // props may follow the diagram, so scan past the expression too.
    const elEnd = src.indexOf('/>', exprEnd);
    const elText = src.slice(elStart, elEnd === -1 ? exprEnd : elEnd);
    const traceMode = !/initialTrace=\{?\s*false/.test(elText);
    // Authored object literal (numbers/strings/arrays only) — evaluate it.
    const diagram = new Function(`return (${literal});`)() as {
      nodes: DiagramNode[];
      connections: DiagramConnection[];
      compoundTypes?: CompoundTypeDefinition[];
    };
    out.push({
      blockStart,
      blockEnd,
      line: src.slice(0, elStart).split('\n').length,
      traceMode,
      nodes: diagram.nodes,
      connections: diagram.connections,
      compoundTypes: diagram.compoundTypes ?? [],
    });
    from = exprEnd;
  }
  return out;
}

function mdxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...mdxFiles(p));
    else if (entry.name.endsWith('.mdx') || entry.name.endsWith('.md')) out.push(p);
  }
  return out;
}

// ── Geometry per diagram ────────────────────────────────────────────────────

interface Placement {
  connId: string;
  /** Effective current t (explicit labelT or the staggered default). */
  t: number;
  /** Per-mode path endpoints (trace geometry shifts the start anchor). */
  ends: Record<'trace' | 'plain', { x1: number; y1: number; x2: number; y2: number }>;
  /** Node labels the badge currently overlaps, per mode. */
  hits: string[];
}

function analyze(d: EmbeddedDiagram): { placements: Placement[]; nodeRects: Record<'trace' | 'plain', Rect[]>; nodeLabels: string[] } {
  const byId = (id: string) => d.nodes.find((n) => n.id === id);
  const pos = (n: DiagramNode) => ({ x: n.x, y: n.y });
  const modes = ['trace', 'plain'] as const;
  const paths = {
    trace: computeConnectionPaths(d.connections, byId, pos, d.compoundTypes, 1, true),
    plain: computeConnectionPaths(d.connections, byId, pos, d.compoundTypes, 1, false),
  };
  const nodeRects = {
    trace: d.nodes.map((n) => ({ x: n.x, y: n.y, w: NODE_W, h: nodeRenderHeight(n, true) })),
    plain: d.nodes.map((n) => ({ x: n.x, y: n.y, w: NODE_W, h: nodeRenderHeight(n, false) })),
  };
  const nodeLabels = d.nodes.map((n) => n.label);

  const placements: Placement[] = [];
  for (const conn of d.connections) {
    const per = {} as Placement['ends'];
    const hits = new Set<string>();
    let t = 0.5;
    for (const mode of modes) {
      const p = paths[mode].find((x) => x.id === conn.id);
      if (!p) continue;
      per[mode] = { x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2 };
      // Recover the effective t (labelT or staggered default) by projecting
      // the badge point back onto the curve — exact for on-curve points.
      t = conn.labelT ?? nearestTOnCurve(p.x1, p.y1, p.x2, p.y2, p.midX, p.midY);
      const rect = badgeRect(p.midX, p.midY, 0);
      nodeRects[mode].forEach((nr, i) => {
        // Only check the initial mode the reader sees: trace hits matter when
        // the embed starts in trace, plain hits when it doesn't. The FIX
        // clears both modes regardless.
        if (mode === (d.traceMode ? 'trace' : 'plain') && overlapDepth(rect, nr) >= MIN_DEPTH) {
          hits.add(nodeLabels[i]);
        }
      });
    }
    placements.push({ connId: conn.id, t, ends: per, hits: [...hits] });
  }
  return { placements, nodeRects, nodeLabels };
}

/** Find the nearest t (2-decimal steps in [0.1, 0.9]) whose badge clears all
 *  nodes in BOTH modes and doesn't collide with other badges. */
function findClearT(
  placement: Placement,
  nodeRects: Record<'trace' | 'plain', Rect[]>,
  otherBadges: Array<{ x: number; y: number }>,
  initialMode: 'trace' | 'plain',
): number | null {
  const candidates: number[] = [];
  for (let step = 0; step <= 40; step++) {
    for (const sign of step === 0 ? [1] : [1, -1]) {
      const t = Math.round((placement.t + sign * step * 0.02) * 100) / 100;
      if (t >= 0.1 && t <= 0.9) candidates.push(t);
    }
  }
  const clearIn = (mode: 'trace' | 'plain', t: number, margin: number, maxDepth: number) => {
    const e = placement.ends[mode];
    if (!e) return true;
    const p = bezierPointAt(e.x1, e.y1, e.x2, e.y2, t);
    const rect = badgeRect(p.x, p.y, margin);
    if (nodeRects[mode].some((nr) => overlapDepth(rect, nr) > maxDepth)) return false;
    if (mode === initialMode) {
      // Keep fixed badges off each other too (checked in the initial mode).
      const bRect = badgeRect(p.x, p.y, 0);
      if (otherBadges.some((b) => intersects(bRect, badgeRect(b.x, b.y, 0)))) return false;
    }
    return true;
  };
  // First pass: a spot fully clear of every node (with margin) in both modes.
  for (const t of candidates) {
    if (clearIn('trace', t, MARGIN, 0) && clearIn('plain', t, MARGIN, 0)) return t;
  }
  // Fallback: tolerate a sub-threshold edge kiss (same bar as the report).
  for (const t of candidates) {
    if (clearIn('trace', t, 0, MIN_DEPTH - 1) && clearIn('plain', t, 0, MIN_DEPTH - 1)) return t;
  }
  return null;
}

// ── Fix application (text splice into the MDX literal) ─────────────────────

interface Fix { blockStart: number; blockEnd: number; connId: string; t: number }

function applyFixes(src: string, fixes: Fix[]): string {
  // Compute splices first, then apply back-to-front so offsets stay valid.
  const splices: Array<{ at: number; remove: number; insert: string }> = [];
  for (const fix of fixes) {
    const block = src.slice(fix.blockStart, fix.blockEnd);
    const connsAt = block.indexOf('connections:');
    if (connsAt === -1) throw new Error(`no connections array for ${fix.connId}`);
    const idRe = new RegExp(`id:\\s*['"]${fix.connId}['"]`);
    const idMatch = idRe.exec(block.slice(connsAt));
    if (!idMatch) throw new Error(`connection ${fix.connId} not found in literal`);
    const idAbs = fix.blockStart + connsAt + idMatch.index;
    const idEnd = idAbs + idMatch[0].length;
    // Does this connection already carry a labelT? Look between this id and
    // the next connection's id (or the end of the block).
    const nextId = /id:\s*['"]/.exec(src.slice(idEnd, fix.blockEnd));
    const scopeEnd = nextId ? idEnd + nextId.index : fix.blockEnd;
    const existing = /labelT:\s*[-\d.]+/.exec(src.slice(idEnd, scopeEnd));
    if (existing) {
      splices.push({ at: idEnd + existing.index, remove: existing[0].length, insert: `labelT: ${fix.t}` });
    } else {
      splices.push({ at: idEnd, remove: 0, insert: `, labelT: ${fix.t}` });
    }
  }
  splices.sort((a, b) => b.at - a.at);
  let out = src;
  for (const s of splices) out = out.slice(0, s.at) + s.insert + out.slice(s.at + s.remove);
  return out;
}

// ── Main ────────────────────────────────────────────────────────────────────

let totalOverlaps = 0;
let totalFixed = 0;
let totalUnfixable = 0;

for (const file of mdxFiles(DOCS_DIR)) {
  const src = readFileSync(file, 'utf8');
  if (!src.includes('<InteractiveDiagram')) continue;
  const rel = relative(REPO_ROOT, file);
  let diagrams: EmbeddedDiagram[];
  try {
    diagrams = extractDiagrams(src);
  } catch (err) {
    console.error(`✖ ${rel}: failed to parse diagram literal — ${(err as Error).message}`);
    process.exitCode = 1;
    continue;
  }

  const fixes: Fix[] = [];
  for (const d of diagrams) {
    const { placements, nodeRects } = analyze(d);
    const initialMode = d.traceMode ? ('trace' as const) : ('plain' as const);
    // Badge centers of connections we are NOT moving (for badge-badge checks).
    const fixedCenters = placements
      .filter((p) => p.hits.length === 0)
      .map((p) => {
        const e = p.ends[initialMode]!;
        return bezierPointAt(e.x1, e.y1, e.x2, e.y2, p.t);
      });

    for (const p of placements) {
      if (p.hits.length === 0) continue;
      totalOverlaps++;
      const suggestion = findClearT(p, nodeRects, fixedCenters, initialMode);
      const where = `${rel}:${d.line}`;
      if (suggestion === null) {
        totalUnfixable++;
        console.log(`✖ ${where} conn '${p.connId}' badge overlaps [${p.hits.join(', ')}] — no clear spot on this wire; move a node instead`);
        continue;
      }
      console.log(
        `${FIX ? '✔' : '!'} ${where} conn '${p.connId}' badge (t=${p.t.toFixed(2)}) overlaps [${p.hits.join(', ')}] → labelT: ${suggestion}`,
      );
      if (FIX) {
        fixes.push({ blockStart: d.blockStart, blockEnd: d.blockEnd, connId: p.connId, t: suggestion });
        const e = p.ends[initialMode]!;
        fixedCenters.push(bezierPointAt(e.x1, e.y1, e.x2, e.y2, suggestion));
        totalFixed++;
      }
    }
  }

  if (FIX && fixes.length > 0) {
    writeFileSync(file, applyFixes(src, fixes));
  }
}

if (totalOverlaps === 0) {
  console.log('All connection badges clear of nodes.');
} else if (FIX) {
  console.log(`\n${totalFixed} badge(s) repositioned${totalUnfixable ? `, ${totalUnfixable} need manual layout` : ''}.`);
} else {
  console.log(`\n${totalOverlaps} overlapping badge(s). Run with --fix to write labelT values.`);
  process.exitCode = 1;
}
