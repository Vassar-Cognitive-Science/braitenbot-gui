/**
 * Shared extractor for the docs' embedded `<InteractiveDiagram>` diagrams.
 *
 * Both the badge-overlap checker (`check-badge-overlaps.ts`) and the diagram
 * render harness (`render-diagrams.ts`) need to pull the authored diagram
 * object literals out of the lesson `.mdx` files and replay the app's render
 * geometry over them. This module owns that scanning so the two scripts agree
 * on exactly what a "diagram" is.
 *
 * The diagram/goal/initialInputs props are plain object literals (numbers,
 * strings, arrays — no function calls), so they can be evaluated directly.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type {
  CompoundTypeDefinition,
  DiagramConnection,
  DiagramNode,
} from '../../src/types/diagram';

export interface EmbeddedDiagram {
  /** Absolute char offset of the diagram object literal in the file. */
  blockStart: number;
  blockEnd: number;
  /** 1-based line of the `<InteractiveDiagram` element. */
  line: number;
  /** Whether the embed boots into trace mode (`initialTrace` defaults true). */
  traceMode: boolean;
  nodes: DiagramNode[];
  connections: DiagramConnection[];
  compoundTypes: CompoundTypeDefinition[];
  /** The `caption="..."` text, if present. */
  caption?: string;
  /** The `goal={{ title: '...' }}` text, if this embed is a puzzle. */
  goalTitle?: string;
  /** Seed sensor/channel values, if authored. */
  initialInputs?: Record<string, number>;
  /** Nearest preceding markdown heading (the puzzle/section name). */
  heading?: string;
}

/**
 * Scan forward from `start` (an opening brace) to its balanced close, honouring
 * string literals so quotes/braces inside captions don't derail the depth
 * count. Returns the index AFTER the closing brace.
 */
export function scanBalanced(src: string, start: number): number {
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

/** Value of a `name={{ ... }}` object-literal prop within an element's text. */
function readObjectProp(src: string, elStart: number, name: string): unknown {
  const at = src.indexOf(`${name}={`, elStart);
  if (at === -1) return undefined;
  const exprStart = at + `${name}=`.length;
  const exprEnd = scanBalanced(src, exprStart);
  const literal = src.slice(exprStart + 1, exprEnd - 1);
  return new Function(`return (${literal});`)();
}

/** Nearest markdown heading (##/###/…) at or above `offset`. */
function precedingHeading(src: string, offset: number): string | undefined {
  const before = src.slice(0, offset);
  const matches = [...before.matchAll(/^#{2,4}\s+(.+)$/gm)];
  const last = matches[matches.length - 1];
  return last ? last[1].trim() : undefined;
}

/**
 * Extract every `<InteractiveDiagram diagram={{...}}>` from an MDX source. Keyed
 * off the `diagram=` prop (the only required object literal); caption, goal
 * title and initialInputs are read opportunistically from the same element.
 */
export function extractDiagrams(src: string): EmbeddedDiagram[] {
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
    // Full element text (through the closing "/>") for prop sniffing. Props may
    // sit before or after the diagram literal, so span the whole element.
    const elEnd = src.indexOf('/>', exprEnd);
    const elText = src.slice(elStart, elEnd === -1 ? exprEnd : elEnd);
    const traceMode = !/initialTrace=\{?\s*false/.test(elText);

    const diagram = new Function(`return (${literal});`)() as {
      nodes: DiagramNode[];
      connections: DiagramConnection[];
      compoundTypes?: CompoundTypeDefinition[];
    };

    const captionMatch = /caption=(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/.exec(elText);
    const goalObj = readObjectProp(src, elStart, 'goal') as { title?: string } | undefined;
    const initialInputs = readObjectProp(src, elStart, 'initialInputs') as
      | Record<string, number>
      | undefined;

    out.push({
      blockStart,
      blockEnd,
      line: src.slice(0, elStart).split('\n').length,
      traceMode,
      nodes: diagram.nodes,
      connections: diagram.connections,
      compoundTypes: diagram.compoundTypes ?? [],
      caption: captionMatch ? (captionMatch[1] ?? captionMatch[2]) : undefined,
      goalTitle: goalObj?.title,
      initialInputs,
      heading: precedingHeading(src, elStart),
    });
    from = exprEnd;
  }
  return out;
}

/** All `.md`/`.mdx` files under `dir`, recursively. */
export function mdxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...mdxFiles(p));
    else if (entry.name.endsWith('.mdx') || entry.name.endsWith('.md')) out.push(p);
  }
  return out;
}

/** The `title:` from a file's YAML frontmatter, if any. */
export function frontmatterTitle(src: string): string | undefined {
  const fm = /^---\n([\s\S]*?)\n---/.exec(src);
  if (!fm) return undefined;
  const t = /^title:\s*["']?(.*?)["']?\s*$/m.exec(fm[1]);
  return t ? t[1] : undefined;
}
