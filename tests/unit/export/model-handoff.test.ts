import { describe, expect, it } from 'vitest';
import { createDefaultProject, createEmptyParameterSet } from '@/core/ir/defaults';
import { getUnitPreset } from '@/core/units/presets';
import { DEFAULT_SHAPE_PARAMS, generateShape } from '@/geometry/primitives/generators';
import { getTransformMatrix } from '@/geometry/transforms';
import { importSTL } from '@/geometry/import/stl-loader';
import { createCadSource } from '@/geometry/import/cad-source';
import { serializeProject } from '@/export/project/save';
import { parseProjectFile } from '@/export/project/load';
import { createProjectBundle, parseProjectBundle } from '@/export/project/bundle';
import { cadExportBodies } from '@/export/cad/exporter';

function assembly() {
  const project = createDefaultProject();
  project.units = getUnitPreset('mm-N-s');
  for (const shapeType of ['box', 'frame2d'] as const) {
    const generated = generateShape(DEFAULT_SHAPE_PARAMS[shapeType], `${shapeType} component`);
    generated.body.transform = { position: [2, -1, 0.5], rotation: [0, 0, 90], scale: [2, 1, 0.5] };
    project.geometry.bodies.push(generated.body);
    project.geometry.faces.push(...generated.faces);
    project.geometry.edges.push(...generated.edges);
    project.geometry.vertices.push(...generated.vertices);
    generated.threeGeometry.dispose();
  }
  project.materials = [{ id: 'steel', name: 'Steel', class: 'elastic', physical_model: 'isotropic_linear', parameter_set: createEmptyParameterSet(), source: 'user', notes: '' }];
  project.sections = [{ id: 'section', name: 'Column', section_type: 'beam_rect', dimensions: { width: 0.1, height: 0.2 }, material_id: 'steel', area: 0.02, inertia_y: null, inertia_z: null, torsion_constant: null, thickness: null, metadata: {} }];
  project.named_selections = [{ id: 'members', name: 'Members', target_dimension: 1, entity_type: 'edge', member_refs: project.geometry.edges.filter(edge => edge.body_id === project.geometry.bodies[1].id).map(edge => edge.id), color: '#ee8844', description: '', created_by: 'user', status: 'active', usages: ['material_assignment', 'section_assignment'] }];
  project.material_assignments = [{ id: 'mat-assignment', material_id: 'steel', target_named_selection_id: 'members', override_allowed: false }];
  project.section_assignments = [{ id: 'sec-assignment', section_id: 'section', target_named_selection_id: 'members' }];
  return project;
}

describe('complete editing model handoff', () => {
  it.each(['JSON', 'Bundle'])('preserves construction, IDs, units, original assets and legacy data through %s', async (format) => {
    const project = assembly();
    const imported = importSTL(new TextEncoder().encode('solid s\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid s').buffer, 'preview.stl');
    imported.asset!.cad_source = createCadSource(new TextEncoder().encode('ISO-10303-21;\nEND-ISO-10303-21;'), 'step', 'original.step');
    imported.body!.metadata = { ...imported.body!.metadata, shapeType: 'imported_cad', importFormat: 'step' };
    project.geometry.bodies.push(imported.body!);
    project.geometry.faces.push(...imported.faces!);
    project.assets.push(imported.asset!);
    imported.geometry!.dispose();
    // Old files remain lossless even though this app no longer exposes analysis editing.
    project.analysis_cases = [{ id: 'legacy-case', name: 'Archived case', active: true, domain_type: 'frame', analysis_type: 'static_linear', nonlinear: false, transient: false, participating_material_ids: [], participating_section_ids: [], participating_bc_ids: [], participating_load_ids: ['legacy-load'], participating_ic_ids: [], mesh_policy_ref: '', solver_profile_hint: 'openseespy_frame_basic', result_requests: ['displacement'] }];
    project.loads = [{ id: 'legacy-load', name: 'Archived load', physics_domain: 'structural', load_type: 'line_load', target_named_selection_id: 'members', application_mode: 'per_length', direction: [0, -1, 0], magnitude: 12, distribution: 'uniform', temporal_profile: 'constant', load_case: 'legacy-case', coordinate_system: 'global', status: 'imported' }];
    const loaded = format === 'JSON' ? parseProjectFile(serializeProject(project))
      : await parseProjectBundle(await (await createProjectBundle(project)).arrayBuffer());
    expect(loaded.success, loaded.error).toBe(true);
    expect({ ...loaded.data, meta: { ...loaded.data!.meta, updated_at: project.meta.updated_at } }).toEqual(project);
  });

  it('includes every body and its world transform without requiring assignments or cases', () => {
    const project = assembly();
    project.materials = []; project.sections = []; project.material_assignments = []; project.section_assignments = [];
    project.analysis_cases = []; project.solver_targets = [];
    const exported = cadExportBodies(project);
    expect(exported).toHaveLength(2);
    expect(exported.map(body => body.name)).toEqual(project.geometry.bodies.map(body => body.name));
    exported.forEach((body, index) => expect(body.matrix).toEqual(getTransformMatrix(project.geometry.bodies[index].transform).elements));
    expect(exported[1].lines).toHaveLength(project.geometry.edges.filter(edge => edge.body_id === project.geometry.bodies[1].id).length);
    expect(exported[1].shape.shapeType).toBe('frame2d');
  });

  it('rejects the entire CAD handoff when any body has only an STL mesh', () => {
    const project = assembly();
    project.geometry.bodies[1].metadata.shapeType = 'imported_stl';
    expect(() => cadExportBodies(project)).toThrow(/STL-only.*no mesh-to-solid reconstruction/);
  });
});
