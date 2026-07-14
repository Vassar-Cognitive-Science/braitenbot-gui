/**
 * Report node-box overlaps in the docs' embedded diagrams. Complements
 * check-badge-overlaps.ts (which checks weight badges): this one flags any two
 * NODE boxes (NODE_W × NODE_H) whose rectangles overlap, so a blind coordinate
 * re-layout can be verified without a browser.
 *
 * Usage (from repo root):  npx tsx docs/scripts/check-node-overlaps.ts
 */
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { NODE_W, NODE_H } from '../../src/components/connectionGeometry';
import { extractDiagrams, mdxFiles } from './diagramExtract';

const DOCS_DIR = join(import.meta.dirname, '..', 'docs');
const REPO_ROOT = join(import.meta.dirname, '..', '..');
// Ignore a few px of edge-kissing; only real overlaps matter.
const MIN_DEPTH = 6;

interface Rect { x: number; y: number; w: number; h: number }
function depth(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? Math.min(w, h) : 0;
}

let total = 0;
for (const file of mdxFiles(DOCS_DIR)) {
  const src = readFileSync(file, 'utf8');
  let diagrams;
  try {
    diagrams = extractDiagrams(src);
  } catch {
    continue;
  }
  for (const d of diagrams) {
    const rects = d.nodes.map((n) => ({
      id: n.id,
      r: { x: n.x, y: n.y, w: NODE_W, h: NODE_H } as Rect,
    }));
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const dep = depth(rects[i].r, rects[j].r);
        if (dep >= MIN_DEPTH) {
          total++;
          console.log(
            `${relative(REPO_ROOT, file)}:${d.line}  ${rects[i].id} ⟷ ${rects[j].id}  (overlap ${Math.round(dep)}px)`,
          );
        }
      }
    }
  }
}
console.log(total === 0 ? '\nNo node overlaps.' : `\n${total} node overlap(s).`);
