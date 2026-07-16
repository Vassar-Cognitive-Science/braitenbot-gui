import { parse } from './diagramFile';
import { validateGraph, buildGraph, generateSketch } from '../codegen';
import type { ValidationError } from '../codegen';

/**
 * Outcome of preparing a lesson circuit (serialized DiagramState posted by the
 * docs' "Upload to bot" button) for a quick upload: either a friendly parse
 * failure, blocking validation errors to render inline, or the generated
 * sketch ready to compile.
 */
export type QuickUploadPrep =
  | { kind: 'parse-error'; message: string }
  | { kind: 'invalid'; errors: ValidationError[] }
  | { kind: 'ready'; code: string };

export function prepareQuickUpload(file: string): QuickUploadPrep {
  let diagram;
  try {
    diagram = parse(file);
  } catch (err) {
    return { kind: 'parse-error', message: err instanceof Error ? err.message : String(err) };
  }
  const errors = validateGraph(diagram.nodes, diagram.connections, diagram.compoundTypes);
  if (errors.some((e) => e.severity === 'error')) {
    return { kind: 'invalid', errors: errors.filter((e) => e.severity === 'error') };
  }
  const graph = buildGraph(
    diagram.nodes,
    diagram.connections,
    diagram.loopPeriodMs,
    diagram.compoundTypes,
  );
  return { kind: 'ready', code: generateSketch(graph, { serialDebug: false }) };
}
