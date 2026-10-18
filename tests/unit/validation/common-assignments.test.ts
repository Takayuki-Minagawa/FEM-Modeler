import { describe, expect, it } from 'vitest';
import { createDefaultProject, createEmptyParameterSet } from '@/core/ir/defaults';
import type { Material, SectionType } from '@/core/ir/types';
import { generateShape } from '@/geometry/primitives/generators';
import { validateCommon } from '@/validation/rules/common';

function material(id: string): Material {
  return {
    id,
    name: id,
    class: 'elastic',
    physical_model: 'isotropic_linear',
    parameter_set: {
      ...createEmptyParameterSet(),
      young_modulus: { value: 200e9, status: 'confirmed' },
      poisson_ratio: { value: 0.3, status: 'confirmed' },
    },
    source: 'test',
    notes: '',
  };
}

describe('common assignment validation', () => {
  it.each([
    ['shell_thickness', 'face', true], ['shell_thickness', 'edge', false],
    ['beam_rect', 'face', false], ['beam_rect', 'edge', true],
    ['beam_rect', 'solid', false], ['beam_rect', 'beam_region', true],
  ] as const)('checks %s compatibility with %s targets', (type, target, allowed) => {
    const project = createDefaultProject();
    const shape = generateShape({ shapeType: 'box', width: 1, height: 1, depth: 1 });
    if (target === 'beam_region') shape.body.category = 'beam_region';
    project.geometry = { ...project.geometry, bodies: [shape.body], faces: shape.faces, edges: shape.edges, vertices: shape.vertices };
    const entityType = target === 'face' || target === 'edge' ? target : 'body';
    project.named_selections.push({ id: 'target', name: 'target', target_dimension: entityType === 'face' ? 2 : entityType === 'edge' ? 1 : 3, entity_type: entityType, member_refs: [entityType === 'face' ? shape.faces[0].id : entityType === 'edge' ? shape.edges[0].id : shape.body.id], color: '#fff', description: '', created_by: 'user', status: 'active', usages: ['section_assignment'] });
    project.sections.push({ id: 'section', name: 'section', section_type: type as SectionType, dimensions: {}, area: 1, inertia_y: 1, inertia_z: 1, torsion_constant: 1, thickness: 0.1, orientation_ref: '', metadata: {} });
    project.section_assignments.push({ id: 'assignment', section_id: 'section', target_named_selection_id: 'target' });
    expect(validateCommon(project).some((issue) => issue.code === 'SECTION_TARGET_DIMENSION')).toBe(!allowed);
  });

  it('rejects competing materials on the same exact target selection', () => {
    const project = createDefaultProject();
    const shape = generateShape({ shapeType: 'box', width: 1, height: 1, depth: 1 }, 'Box');
    project.geometry.bodies.push(shape.body);
    project.geometry.faces.push(...shape.faces);
    project.geometry.edges.push(...shape.edges);
    project.geometry.vertices.push(...shape.vertices);
    project.named_selections.push({
      id: 'domain',
      name: 'domain',
      target_dimension: 3,
      entity_type: 'body',
      member_refs: [shape.body.id],
      color: '#fff',
      description: '',
      created_by: 'user',
      status: 'active',
      usages: ['material_assignment'],
    });
    project.materials.push(material('steel'), material('aluminum'));
    project.material_assignments.push(
      { id: 'assign_steel', material_id: 'steel', target_named_selection_id: 'domain', override_allowed: false },
      { id: 'assign_aluminum', material_id: 'aluminum', target_named_selection_id: 'domain', override_allowed: false },
    );

    const codes = validateCommon(project).map((item) => item.code);
    expect(codes).toContain('OVERLAPPING_MATERIAL_ASSIGNMENT');
  });
});
