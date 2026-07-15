import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import type {
  BoundaryCondition,
  GeometryEdge,
  Load,
  Material,
  NamedSelection,
  ProjectIR,
  Section,
} from '@/core/ir/types';
import { createDefaultProject, createEmptyParameterSet } from '@/core/ir/defaults';
import { generateShape } from '@/geometry/primitives/generators';
import { applyTemplate } from '@/lib/project-templates';
import { useAppStore } from '@/state/store';
import {
  buildOpenSeesPyTopology,
  compileOpenSeesPyModel,
  exportOpenSeesPy,
} from '@/export/openseespy/exporter';

function makeMaterial(id: string, youngModulus: number | null): Material {
  return {
    id,
    name: id,
    class: 'elastic',
    physical_model: 'isotropic_linear',
    parameter_set: {
      ...createEmptyParameterSet(),
      young_modulus: { value: youngModulus, status: youngModulus === null ? 'missing' : 'confirmed' },
    },
    source: 'test',
    notes: '',
  };
}

function makeSection(
  id: string,
  materialId: string,
  area = 0.01,
  inertiaZ = 1e-4,
): Section {
  return {
    id,
    name: id,
    section_type: 'generic_frame_section',
    dimensions: {},
    material_id: materialId,
    area,
    inertia_y: 2e-4,
    inertia_z: inertiaZ,
    torsion_constant: null,
    thickness: null,
    metadata: {},
  };
}

function makeSelection(
  id: string,
  refs: string[],
  entityType: NamedSelection['entity_type'] = 'vertex',
): NamedSelection {
  return {
    id,
    name: id,
    display_name: id,
    target_dimension: entityType === 'body' ? 3 : entityType === 'edge' ? 1 : 0,
    entity_type: entityType,
    member_refs: refs,
    color: '#ffffff',
    description: '',
    created_by: 'user',
    status: 'active',
    usages: [],
  };
}

function fixedBc(id: string, selectionId: string): BoundaryCondition {
  return {
    id,
    name: id,
    physics_domain: 'structural',
    bc_type: 'fixed',
    target_named_selection_id: selectionId,
    coordinate_system: 'global',
    values: {
      dof_map: {
        ux: 'fixed', uy: 'fixed', uz: 'free',
        rx: 'free', ry: 'free', rz: 'fixed',
      },
    },
    temporal_profile: 'constant',
    status: 'confirmed',
    notes: '',
  };
}

function nodalLoad(id: string, selectionId: string): Load {
  return {
    id,
    name: id,
    physics_domain: 'structural',
    load_type: 'nodal_force',
    target_named_selection_id: selectionId,
    application_mode: 'total',
    direction: [1, 0, 0],
    magnitude: 1000,
    distribution: 'uniform',
    temporal_profile: 'constant',
    load_case: 'default',
    coordinate_system: 'global',
    status: 'confirmed',
  };
}

function makeValidFrameProject(): {
  project: ProjectIR;
  vertexIds: string[];
  bodyId: string;
} {
  const project = createDefaultProject();
  const shape = generateShape(
    { shapeType: 'frame2d', spanX: 4, spanY: 3, columns: 2, floors: 1 },
    'Frame',
  );
  project.geometry.bodies.push(shape.body);
  project.geometry.vertices.push(...shape.vertices);
  project.materials.push(makeMaterial('steel', 2.1e11));
  project.sections.push(makeSection('section', 'steel'));

  const support = makeSelection('support', [shape.vertices[0].id, shape.vertices[1].id]);
  const loaded = makeSelection('loaded', [shape.vertices[2].id, shape.vertices[3].id]);
  const members = makeSelection('members', [shape.body.id], 'body');
  project.named_selections.push(support, loaded, members);
  project.section_assignments.push({
    id: 'section-assignment',
    section_id: 'section',
    target_named_selection_id: members.id,
  });
  project.boundary_conditions.push(fixedBc('fixed', support.id));
  project.loads.push(nodalLoad('force', loaded.id));
  project.analysis_cases.push({
    id: 'case',
    name: 'Static frame',
    active: true,
    domain_type: 'frame',
    analysis_type: 'static_linear',
    nonlinear: false,
    transient: false,
    participating_material_ids: ['steel'],
    participating_section_ids: ['section'],
    participating_bc_ids: ['fixed'],
    participating_load_ids: ['force'],
    participating_ic_ids: [],
    mesh_policy_ref: '',
    solver_profile_hint: 'openseespy_frame_basic',
    result_requests: ['displacement', 'reaction_force'],
  });

  return {
    project,
    vertexIds: shape.vertices.map((vertex) => vertex.id),
    bodyId: shape.body.id,
  };
}

describe('OpenSeesPy pure topology compiler', () => {
  it('rejects multiple beam bodies instead of silently exporting the first', () => {
    const { project } = makeValidFrameProject();
    const second = generateShape(
      { shapeType: 'frame2d', spanX: 2, spanY: 2, columns: 2, floors: 1 },
      'Second frame',
    );
    project.geometry.bodies.push(second.body);
    project.geometry.vertices.push(...second.vertices);

    const topology = buildOpenSeesPyTopology(project);
    const exported = exportOpenSeesPy(project);

    expect(topology.topology).toBeNull();
    expect(topology.errors).toContain(
      'OpenSeesPy export currently supports exactly one beam_region body; found 2. No body was exported.',
    );
    expect(exported.success).toBe(false);
    expect(exported.nodesCsv).toBe('');
    expect(exported.script).toBe('');
  });

  it('rejects disconnected structural components even when every node has an edge', () => {
    const { project, vertexIds } = makeValidFrameProject();
    const bodyId = project.geometry.bodies[0].id;
    project.geometry.edges = [
      { id: 'component-a', name: 'component-a', body_id: bodyId, vertex_ids: [vertexIds[0], vertexIds[2]] },
      { id: 'component-b', name: 'component-b', body_id: bodyId, vertex_ids: [vertexIds[1], vertexIds[3]] },
    ];

    const result = exportOpenSeesPy(project);
    expect(result.success).toBe(false);
    expect(result.errors.some((error) => error.includes('disconnected structural components'))).toBe(true);
  });

  it('rejects a connected pin-jointed truss with an internal mechanism', () => {
    useAppStore.getState().createProject('mechanism', 'truss');
    applyTemplate('truss', 'en');
    const project = structuredClone(useAppStore.getState().ir);
    const diagonal = project.geometry.edges.find((edge) => edge.name.startsWith('diagonal_'));
    expect(diagonal).toBeDefined();
    const bottomVertices = project.geometry.vertices
      .filter((vertex) => Math.abs(vertex.position[1]) < 1e-12)
      .sort((left, right) => left.position[0] - right.position[0]);
    // Keep Maxwell's member count unchanged, but replace one stabilizing brace
    // with a redundant long bottom-chord member.
    diagonal!.vertex_ids = [bottomVertices[0].id, bottomVertices[2].id];

    const result = exportOpenSeesPy(project);
    expect(result.success).toBe(false);
    expect(result.errors.some((error) => error.includes('internal mechanism'))).toBe(true);
  });

  it('matches the viewer truss bottom, top and non-zero diagonal graph', () => {
    const project = createDefaultProject();
    const shape = generateShape(
      { shapeType: 'truss2d', span: 8, height: 2, divisions: 4 },
      'Truss',
    );
    project.geometry.bodies.push(shape.body);

    const result = buildOpenSeesPyTopology(project);
    expect(result.errors).toEqual([]);
    expect(result.topology?.nodes.map(({ x, y }) => [x, y])).toEqual([
      [0, 0], [2, 0], [4, 0], [6, 0], [8, 0],
      [2, 1], [4, 2], [6, 1],
    ]);
    expect(result.topology?.elements.map(({ nodeI, nodeJ }) => [nodeI, nodeJ])).toEqual([
      [1, 2], [2, 3], [3, 4], [4, 5],
      [1, 6], [6, 7], [7, 8], [8, 5],
      [2, 6], [3, 7], [4, 8],
      [2, 7], [7, 4],
    ]);
    expect(result.topology?.elements).toHaveLength(2 * (result.topology?.nodes.length ?? 0) - 3);
  });

  it('uses explicit geometry edges as the authoritative member graph', () => {
    const { project, vertexIds, bodyId } = makeValidFrameProject();
    const edges: GeometryEdge[] = [
      { id: 'diagonal', name: 'diagonal', body_id: bodyId, vertex_ids: [vertexIds[0], vertexIds[3]] },
      { id: 'bottom', name: 'bottom', body_id: bodyId, vertex_ids: [vertexIds[0], vertexIds[1]] },
      { id: 'right', name: 'right', body_id: bodyId, vertex_ids: [vertexIds[1], vertexIds[3]] },
      { id: 'top', name: 'top', body_id: bodyId, vertex_ids: [vertexIds[3], vertexIds[2]] },
    ];
    project.geometry.edges.push(...edges);

    const result = buildOpenSeesPyTopology(project);

    expect(result.errors).toEqual([]);
    expect(result.topology?.elements.map(({ nodeI, nodeJ, sourceRefs }) =>
      [nodeI, nodeJ, sourceRefs[0]])).toEqual([
      [1, 4, 'diagonal'],
      [1, 2, 'bottom'],
      [2, 4, 'right'],
      [4, 3, 'top'],
    ]);
  });
});

describe('OpenSeesPy strict model compiler', () => {
  it('resolves per-member section and material assignments without first-item fallback', () => {
    const { project, vertexIds, bodyId } = makeValidFrameProject();
    project.geometry.edges.push(
      { id: 'left', name: 'left', body_id: bodyId, vertex_ids: [vertexIds[0], vertexIds[2]] },
      { id: 'right', name: 'right', body_id: bodyId, vertex_ids: [vertexIds[1], vertexIds[3]] },
      { id: 'top', name: 'top', body_id: bodyId, vertex_ids: [vertexIds[2], vertexIds[3]] },
    );
    project.materials.push(makeMaterial('aluminum', 7e10));
    project.sections.push(makeSection('beam-section', 'aluminum', 0.02, 3e-4));
    project.named_selections.push(
      makeSelection('columns', ['left', 'right'], 'edge'),
      makeSelection('beam', ['top'], 'edge'),
    );
    project.section_assignments = [
      { id: 'assign-columns', section_id: 'section', target_named_selection_id: 'columns' },
      { id: 'assign-beam', section_id: 'beam-section', target_named_selection_id: 'beam' },
    ];
    project.material_assignments.push({
      id: 'override-columns',
      material_id: 'aluminum',
      target_named_selection_id: 'columns',
      override_allowed: true,
    });
    project.analysis_cases[0].participating_material_ids = ['aluminum'];
    project.analysis_cases[0].participating_section_ids.push('beam-section');

    const result = compileOpenSeesPyModel(project);

    expect(result.errors).toEqual([]);
    expect(result.model?.elements.map((element) => ({
      section: element.sectionId,
      material: element.materialId,
      area: element.area,
      e: element.youngModulus,
    }))).toEqual([
      { section: 'section', material: 'aluminum', area: 0.01, e: 7e10 },
      { section: 'section', material: 'aluminum', area: 0.01, e: 7e10 },
      { section: 'beam-section', material: 'aluminum', area: 0.02, e: 7e10 },
    ]);
  });

  it('does not substitute missing material or section values', () => {
    const { project } = makeValidFrameProject();
    project.materials[0] = makeMaterial('steel', null);
    project.sections[0].area = null;

    const result = exportOpenSeesPy(project);

    expect(result.success).toBe(false);
    expect(result.errors).toContain(
      'Section "section" area must be a finite positive number; no default was substituted.',
    );
    expect(result.errors).toContain(
      'Material "steel" Young\'s modulus must be a finite positive number; no default was substituted.',
    );
    expect(result.script).toBe('');
  });

  it('rejects unresolved named-selection members instead of guessing bottom/top nodes', () => {
    const { project } = makeValidFrameProject();
    project.named_selections.find(({ id }) => id === 'support')!.member_refs = ['missing-vertex'];

    const result = compileOpenSeesPyModel(project);

    expect(result.model).toBeNull();
    expect(result.errors).toContain(
      `Named selection "support" member "missing-vertex" is not an exact vertex of body "${project.geometry.bodies[0].id}".`,
    );
    expect(result.errors).toContain(
      'No structural boundary conditions could be resolved. Define exact named-selection targets before exporting.',
    );
  });

  it('rejects a non-vertex member hidden inside a vertex-typed nodal selection', () => {
    const { project, bodyId } = makeValidFrameProject();
    project.named_selections.find(({ id }) => id === 'support')!.member_refs = [bodyId];

    const result = exportOpenSeesPy(project);
    expect(result.success).toBe(false);
    expect(result.errors.some((error) => error.includes('is not an exact vertex'))).toBe(true);
  });

  it('rejects unimplemented local section-axis orientation', () => {
    const { project } = makeValidFrameProject();
    project.sections[0].orientation_ref = 'local-axis';

    const result = exportOpenSeesPy(project);
    expect(result.success).toBe(false);
    expect(result.errors.some((error) => error.includes('local section-axis orientation is not implemented'))).toBe(true);
  });

  it('rejects explicitly participating materials and sections that no element consumes', () => {
    const { project } = makeValidFrameProject();
    project.materials.push(makeMaterial('unused-material', 1e9));
    project.sections.push(makeSection('unused-section', 'unused-material'));
    project.analysis_cases[0].participating_material_ids.push('unused-material');
    project.analysis_cases[0].participating_section_ids.push('unused-section');

    const result = exportOpenSeesPy(project);
    expect(result.success).toBe(false);
    expect(result.errors.some((error) => error.includes('Participating material "unused-material"'))).toBe(true);
    expect(result.errors.some((error) => error.includes('Participating section "unused-section"'))).toBe(true);
  });

  it('rejects non-applicable continuum mesh controls instead of reporting them as consumed', () => {
    const { project } = makeValidFrameProject();
    project.mesh_controls.global.global_size = 0.25;

    const result = exportOpenSeesPy(project);
    const manifest = JSON.parse(result.manifest) as { consumed_ir_ids: string[] };

    expect(result.success).toBe(false);
    expect(result.errors.some((error) => error.includes('mesh_controls.global.global_size'))).toBe(true);
    expect(manifest.consumed_ir_ids).not.toContain('mesh_controls.global');
  });

  it('rejects an unconsumed participating assignment', () => {
    const { project } = makeValidFrameProject();
    project.named_selections.push(makeSelection('unused-members', [], 'edge'));
    project.section_assignments.push({
      id: 'unused-assignment',
      section_id: 'section',
      target_named_selection_id: 'unused-members',
    });

    const result = exportOpenSeesPy(project);
    expect(result.success).toBe(false);
    expect(result.errors).toContain(
      'Participating section assignment "unused-assignment" is not consumed by any exported element.',
    );
  });

  it('merges multiple BCs by DOF and emits non-zero prescribed displacement values', () => {
    const { project, vertexIds } = makeValidFrameProject();
    project.named_selections.find(({ id }) => id === 'support')!.member_refs = [vertexIds[0]];
    project.boundary_conditions = [
      {
        ...fixedBc('partial-fix', 'support'),
        values: {
          dof_map: {
            ux: 'fixed', uy: 'free', uz: 'free',
            rx: 'free', ry: 'free', rz: 'fixed',
          },
        },
      },
      {
        id: 'settlement',
        name: 'settlement',
        physics_domain: 'structural',
        bc_type: 'prescribed_displacement',
        target_named_selection_id: 'support',
        coordinate_system: 'global',
        values: {
          vector: [0, -0.012, 0],
          dof_map: {
            ux: 'free', uy: 'prescribed', uz: 'free',
            rx: 'free', ry: 'free', rz: 'free',
          },
        },
        temporal_profile: 'constant',
        status: 'confirmed',
        notes: '',
      },
    ];
    project.analysis_cases[0].participating_bc_ids = ['partial-fix', 'settlement'];

    const compiled = compileOpenSeesPyModel(project);
    const exported = exportOpenSeesPy(project);

    expect(compiled.errors).toEqual([]);
    expect(compiled.model?.fixes).toEqual([{ nodeId: 1, dofs: [1, 0, 1] }]);
    expect(compiled.model?.prescribedDisplacements).toEqual([
      { nodeId: 1, dof: 2, value: -0.012 },
    ]);
    expect(exported.script).toContain('ops.fix(1, 1, 0, 1)');
    expect(exported.script).toContain('ops.sp(1, 2, -0.012)');
  });

  it('reports unsupported load types and application modes explicitly', () => {
    const { project } = makeValidFrameProject();
    project.loads = [
      { ...project.loads[0], id: 'pressure', name: 'pressure', load_type: 'pressure' },
      {
        ...project.loads[0],
        id: 'per-area',
        name: 'per-area',
        application_mode: 'per_area',
      },
    ];
    project.analysis_cases[0].participating_load_ids = ['pressure', 'per-area'];

    const result = compileOpenSeesPyModel(project);

    expect(result.model).toBeNull();
    expect(result.errors).toContain('Load "pressure" has unsupported OpenSeesPy type "pressure".');
    expect(result.errors).toContain(
      'Nodal load "per-area" has unsupported application mode "per_area"; expected total.',
    );
  });

  it('rejects a participating item from another physics domain', () => {
    const { project } = makeValidFrameProject();
    project.loads[0] = { ...project.loads[0], physics_domain: 'thermal' };

    const result = exportOpenSeesPy(project);
    expect(result.success).toBe(false);
    expect(result.errors).toContain('OpenSeesPy load "force" belongs to thermal, not structural.');
  });

  it('rejects rotational prescribed displacement because scalar values are translational SI lengths', () => {
    const { project } = makeValidFrameProject();
    project.boundary_conditions[0] = {
      ...project.boundary_conditions[0],
      bc_type: 'prescribed_displacement',
      values: {
        scalar: 0.01,
        dof_map: { ux: 'free', uy: 'free', uz: 'free', rx: 'free', ry: 'free', rz: 'prescribed' },
      },
    };

    const result = exportOpenSeesPy(project);
    expect(result.success).toBe(false);
    expect(result.errors.some((error) => error.includes('rotational DOF rz'))).toBe(true);
  });

  it('distributes total nodal force exactly and checks ops.analyze return status', () => {
    const { project } = makeValidFrameProject();

    const compiled = compileOpenSeesPyModel(project);
    const result = exportOpenSeesPy(project);

    expect(compiled.errors).toEqual([]);
    expect(compiled.model?.nodalLoads).toEqual([
      { nodeId: 3, fx: 500, fy: 0 },
      { nodeId: 4, fx: 500, fy: 0 },
    ]);
    expect(result.script).toContain('analysis_result = ops.analyze(1)');
    expect(result.script).toContain('if analysis_result != 0:');
    expect(result.script).toContain(
      'raise RuntimeError(f"OpenSees analysis failed with code {analysis_result}")',
    );
    expect(result.script).toContain('"export_target": "OpenSeesPy"');
    expect(result.script).toContain('"analysis_case_id": "case"');
    expect(result.script).toContain(`"model_revision": ${project.validation.model_revision}`);
    const syntax = spawnSync(
      'python3',
      ['-c', 'import sys; compile(sys.stdin.read(), "model.py", "exec")'],
      { input: result.script, encoding: 'utf8' },
    );
    expect(syntax.stderr).toBe('');
    expect(syntax.status).toBe(0);
  });

  it('exports only items participating in the active analysis case and reports exclusions', () => {
    const { project, bodyId, vertexIds } = makeValidFrameProject();
    project.loads.push(nodalLoad('excluded-force', 'loaded'));
    project.analysis_cases[0].participating_load_ids = ['force'];

    const compiled = compileOpenSeesPyModel(project);
    const exported = exportOpenSeesPy(project);
    const manifest = JSON.parse(exported.manifest) as {
      analysis_case_id: string;
      consumed_ir_ids: string[];
      ignored_ir_ids: string[];
    };

    expect(compiled.errors).toEqual([]);
    expect(compiled.model?.nodalLoads.reduce((sum, load) => sum + load.fx, 0)).toBe(1000);
    expect(compiled.warnings[0]).toContain('outside analysis case');
    expect(manifest.analysis_case_id).toBe('case');
    expect(manifest.consumed_ir_ids).toEqual(expect.arrayContaining([
      'case',
      bodyId,
      ...vertexIds,
      'steel',
      'section',
      'section-assignment',
      'members',
      'support',
      'loaded',
      'fixed',
      'force',
      'result_request:case:displacement',
      'result_request:case:reaction_force',
    ]));
    expect(manifest.consumed_ir_ids).not.toContain('mesh_controls.global');
    expect(manifest.ignored_ir_ids).toContain('excluded-force');
  });
});
