import { describe, expect, it } from 'vitest';
import { createModelProject } from '@/modeling/project';
import { createMaterialFromLibrary, MATERIAL_LIBRARY } from '@/lib/material-library';
import { materialOverlays } from '@/viewer/material-data';
import { applyTransformToPoint } from '@/geometry/transforms';

function assignedModel(template: 'frame' | 'plate') {
  const ir = structuredClone(createModelProject('Material view', template, 'en'));
  const material = createMaterialFromLibrary(MATERIAL_LIBRARY[0], 'en');
  ir.materials.push(material);
  ir.material_assignments.push({ id: 'assignment', material_id: material.id, target_named_selection_id: ir.named_selections[0].id, override_allowed: false });
  return ir;
}

describe('model material overlays', () => {
  it('renders the assigned frame graph in world coordinates without an analysis case', () => {
    const ir = assignedModel('frame');
    const body = ir.geometry.bodies[0];
    body.transform = { position: [10, 20, 30], rotation: [0, 0, 90], scale: [2, 3, 4] };
    const overlay = materialOverlays(ir)[0];
    expect(ir.analysis_cases).toHaveLength(0);
    expect(overlay.segments).toHaveLength(ir.geometry.edges.length * 6);
    const firstEdge = ir.geometry.edges[0];
    const expected = firstEdge.vertex_ids.flatMap((id) => applyTransformToPoint(ir.geometry.vertices.find((vertex) => vertex.id === id)!.position, body.transform));
    expect(overlay.segments.slice(0, 6)).toEqual(expected);
    expect(overlay.target.points.length).toBeGreaterThan(0);
  });

  it('colors surfaces and excludes hidden geometry or inactive selections', () => {
    const ir = assignedModel('plate');
    expect(materialOverlays(ir)[0].target.triangles.length).toBeGreaterThan(0);
    ir.geometry.bodies[0].visible = false;
    expect(materialOverlays(ir)[0].target.points).toEqual([]);
    expect(materialOverlays(ir)[0].segments).toEqual([]);
    ir.named_selections[0].status = 'stale';
    expect(materialOverlays(ir)).toEqual([]);
  });
});
