import { runCADTask } from '@/cad/async';
import type { CADExportBody, CADFormat } from '@/cad/types';
import type { ProjectIR } from '@/core/ir/types';
import { parseNativeShapeMetadata } from '@/core/ir/schema/shapes';
import { getTransformMatrix } from '@/geometry/transforms';
import { validateCadSource } from '@/geometry/import/cad-source';
import { sanitizeArtifactName } from '@/export/shared/artifact-sanitization';

export function cadExportBodies(ir: ProjectIR): CADExportBody[] {
  if (!ir.geometry.bodies.length) throw new Error('There are no bodies to export.');
  let sourceBytes = 0;
  return ir.geometry.bodies.map((body) => {
    let shape: CADExportBody['shape'];
    if (body.metadata.shapeType === 'imported_cad') {
      const source = ir.assets.find((asset) => asset.id === body.asset_ref)?.cad_source;
      if (!source) throw new Error(`Body "${body.name}" has no original CAD data.`);
      const data = validateCadSource(source); sourceBytes += data.byteLength;
      if (sourceBytes > 100 * 1024 * 1024) throw new Error('CAD input for one export exceeds 100 MiB.');
      shape = { shapeType: 'imported_cad', format: source.format, data };
    } else if (body.metadata.shapeType === 'imported_stl') {
      throw new Error(`Body "${body.name}" is STL-only. Exact STEP/IGES export requires CAD surfaces; no mesh-to-solid reconstruction is performed.`);
    } else shape = parseNativeShapeMetadata(body.metadata);
    const matrix = getTransformMatrix(body.transform).elements;
    if (!matrix.every(Number.isFinite) || body.transform.scale.some((value) => Math.abs(value) < 1e-12)) throw new Error(`Body "${body.name}" has an invalid or zero transform.`);
    const item: CADExportBody = { name: body.name, shape, matrix };
    if (shape.shapeType === 'frame2d' || shape.shapeType === 'truss2d') {
      const vertices = new Map(ir.geometry.vertices.filter((vertex) => vertex.body_id === body.id).map((vertex) => [vertex.id, vertex.position]));
      item.lines = ir.geometry.edges.filter((edge) => edge.body_id === body.id).map((edge) => {
        const a = vertices.get(edge.vertex_ids[0]), b = vertices.get(edge.vertex_ids[1]);
        if (!a || !b || [...a, ...b].some((value) => !Number.isFinite(value)) || a.every((value, index) => value === b[index])) throw new Error(`Invalid CAD frame edge "${edge.name}".`);
        return [a, b];
      });
    }
    return item;
  });
}

export async function downloadCAD(ir: ProjectIR, format: CADFormat, signal?: AbortSignal): Promise<{ errors: string[]; warnings: string[] }> {
  const bodies = cadExportBodies(ir);
  const bytes = await runCADTask({ operation: 'export', format, bodies }, signal);
  if (!(bytes instanceof Uint8Array)) throw new Error('Invalid CAD export response.');
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: format === 'step' ? 'model/step' : 'model/iges' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = `${sanitizeArtifactName(ir.meta.project_name)}.${format}`; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  const wires = bodies.some((body) => body.shape.shapeType === 'frame2d' || body.shape.shapeType === 'truss2d');
  return { errors: [], warnings: wires ? ['Frame/truss members are exported as centreline curves, without section solids. Curve-only CAD cannot be re-imported by the surface viewer.'] : [] };
}
