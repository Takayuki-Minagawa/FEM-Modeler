import { beforeEach, describe, expect, it } from 'vitest';
import { exportDOLFINx } from '@/export/dolfinx/exporter';
import { exportOpenFOAM } from '@/export/openfoam/exporter';
import { exportOpenSeesPy } from '@/export/openseespy/exporter';
import type { DomainType, ProjectIR, SolverTargetName } from '@/core/ir/types';
import { applyTemplate } from '@/lib/project-templates';
import { useAppStore } from '@/state/store';
import { runValidation } from '@/validation/engine';

function createTemplate(domain: DomainType): ProjectIR {
  useAppStore.getState().createProject(`${domain} benchmark`, domain);
  applyTemplate(domain, 'en');
  return useAppStore.getState().ir;
}

function expectOnlySolver(ir: ProjectIR, expected: SolverTargetName): void {
  expect(ir.solver_targets.filter((target) => target.enabled).map((target) => target.target_name))
    .toEqual([expected]);
  expect(ir.meta.default_solver_target).toBe(expected);
}

function referencedMembers(ir: ProjectIR, selectionId: string): string[] {
  const selection = ir.named_selections.find((candidate) => candidate.id === selectionId);
  expect(selection).toBeDefined();
  return selection?.member_refs ?? [];
}

describe('solver-ready project templates', () => {
  beforeEach(() => {
    useAppStore.getState().createProject('blank', 'frame');
  });

  it('creates a frame with persisted topology and separate support/load vertices', () => {
    const ir = createTemplate('frame');
    const support = ir.boundary_conditions[0];
    const load = ir.loads[0];
    const supportMembers = referencedMembers(ir, support.target_named_selection_id);
    const loadMembers = referencedMembers(ir, load.target_named_selection_id);
    const vertices = new Map(ir.geometry.vertices.map((vertex) => [vertex.id, vertex]));

    expect(ir.geometry.edges.length).toBeGreaterThan(0);
    expect(ir.geometry.vertices.length).toBeGreaterThan(0);
    expect(supportMembers.every((id) => vertices.get(id)?.position[1] === 0)).toBe(true);
    expect(loadMembers.every((id) => vertices.get(id)?.position[1] === 9)).toBe(true);
    expect(supportMembers.some((id) => loadMembers.includes(id))).toBe(false);
    expect(ir.section_assignments).toHaveLength(1);
    expect(ir.material_assignments).toHaveLength(1);
    expectOnlySolver(ir, 'OpenSeesPy');

    const exported = exportOpenSeesPy(ir);
    expect(exported.errors).toEqual([]);
    expect(exported.success).toBe(true);
  });

  it('creates a stable planar truss with pin/roller supports and an apex load', () => {
    const ir = createTemplate('truss');
    const analysis = ir.analysis_cases[0];
    const supportBCs = ir.boundary_conditions;
    const load = ir.loads[0];
    const vertexById = new Map(ir.geometry.vertices.map((vertex) => [vertex.id, vertex]));
    const supportVertices = supportBCs.flatMap((condition) =>
      referencedMembers(ir, condition.target_named_selection_id));
    const loadVertexIds = referencedMembers(ir, load.target_named_selection_id);

    expect(ir.geometry.bodies[0].metadata.shapeType).toBe('truss2d');
    expect(ir.geometry.edges).toHaveLength(2 * ir.geometry.vertices.length - 3);
    expect(supportBCs).toHaveLength(2);
    expect(new Set(supportVertices).size).toBe(2);
    expect(supportVertices.every((id) => vertexById.get(id)?.position[1] === 0)).toBe(true);
    expect(loadVertexIds).toHaveLength(1);
    expect(vertexById.get(loadVertexIds[0])?.position[1]).toBe(2);
    expect(analysis.participating_bc_ids).toEqual(supportBCs.map((condition) => condition.id));
    expect(analysis.participating_load_ids).toEqual([load.id]);
    expectOnlySolver(ir, 'OpenSeesPy');

    const exported = exportOpenSeesPy(ir);
    expect(exported.errors).toEqual([]);
    expect(exported.success).toBe(true);
  });

  it('creates an exactly tagged, constrained plate-with-hole DOLFINx model', () => {
    const ir = createTemplate('solid');
    const faceIds = new Set(ir.geometry.faces.map((face) => face.id));
    const faceSelections = ir.named_selections.filter((selection) => selection.entity_type === 'face');
    const analysis = ir.analysis_cases[0];

    expect(faceSelections).toHaveLength(2);
    expect(faceSelections.flatMap((selection) => selection.member_refs)
      .every((faceId) => faceIds.has(faceId))).toBe(true);
    expect(ir.material_assignments).toHaveLength(1);
    expect(analysis.participating_material_ids).toEqual([ir.materials[0].id]);
    expect(analysis.participating_bc_ids).toEqual([ir.boundary_conditions[0].id]);
    expect(analysis.participating_load_ids).toEqual([ir.loads[0].id]);
    expect(analysis.result_requests).toEqual(['displacement']);
    expectOnlySolver(ir, 'DOLFINx');

    const exported = exportDOLFINx(ir);
    expect(exported.errors).toEqual([]);
    expect(exported.success).toBe(true);
  });

  it('creates a well-posed thermal plate with a reference temperature and surface heat input', () => {
    const ir = createTemplate('thermal');
    const analysis = ir.analysis_cases[0];

    expect(ir.boundary_conditions.map((condition) => condition.bc_type)).toEqual(['temperature']);
    expect(ir.loads.map((load) => load.load_type)).toEqual(['heat_source']);
    expect(analysis.participating_material_ids).toEqual([ir.materials[0].id]);
    expect(analysis.participating_bc_ids).toEqual([ir.boundary_conditions[0].id]);
    expect(analysis.participating_load_ids).toEqual([ir.loads[0].id]);
    expect(analysis.result_requests).toEqual(['temperature']);
    expectOnlySolver(ir, 'DOLFINx');

    const exported = exportDOLFINx(ir);
    expect(exported.errors).toEqual([]);
    expect(exported.success).toBe(true);
  });

  it('creates face-based channel patches and an assigned water domain', () => {
    const ir = createTemplate('fluid');
    const analysis = ir.analysis_cases[0];
    const faceIds = new Set(ir.geometry.faces.map((face) => face.id));
    const boundarySelectionIds = new Set(
      ir.boundary_conditions.map((condition) => condition.target_named_selection_id),
    );
    const boundarySelections = ir.named_selections.filter((selection) =>
      boundarySelectionIds.has(selection.id));
    const outlet = ir.boundary_conditions.find((condition) => condition.bc_type === 'pressure_outlet');

    expect(boundarySelections).toHaveLength(4);
    expect(boundarySelections.every((selection) =>
      selection.entity_type === 'face'
      && selection.target_dimension === 2
      && selection.member_refs.every((faceId) => faceIds.has(faceId)))).toBe(true);
    expect(ir.materials[0].class).toBe('fluid_newtonian');
    expect(ir.material_assignments).toHaveLength(1);
    expect(outlet?.values.pressure_basis).toBe('dynamic');
    expect(analysis.participating_material_ids).toEqual([ir.materials[0].id]);
    expect(analysis.participating_bc_ids).toEqual(ir.boundary_conditions.map((condition) => condition.id));
    expect(analysis.result_requests).toEqual(['velocity', 'pressure']);
    expectOnlySolver(ir, 'OpenFOAM');

    const exported = exportOpenFOAM(ir);
    expect(exported.errors).toEqual([]);
    expect(exported.success).toBe(true);
  });

  it('applies each template as one undo transaction', () => {
    createTemplate('frame');
    expect(useAppStore.getState().ir.geometry.bodies).toHaveLength(1);

    useAppStore.getState().undo();

    const ir = useAppStore.getState().ir;
    expect(ir.geometry.bodies).toEqual([]);
    expect(ir.geometry.edges).toEqual([]);
    expect(ir.geometry.vertices).toEqual([]);
    expect(ir.materials).toEqual([]);
    expect(ir.sections).toEqual([]);
    expect(ir.boundary_conditions).toEqual([]);
    expect(ir.loads).toEqual([]);
  });

  it.each([
    ['frame', 'OpenSeesPy'],
    ['truss', 'OpenSeesPy'],
    ['solid', 'DOLFINx'],
    ['thermal', 'DOLFINx'],
    ['fluid', 'OpenFOAM'],
  ] as const)('passes strict common and %s solver validation', (domain, target) => {
    const ir = createTemplate(domain);
    const validation = runValidation(ir, target, ir.analysis_cases[0].id);

    expect(
      validation.items.filter((item) => item.severity === 'error'),
      validation.items.map((item) => `${item.code}: ${item.message}`).join('\n'),
    ).toEqual([]);
  });
});
