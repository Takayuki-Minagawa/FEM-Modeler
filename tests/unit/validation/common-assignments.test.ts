import { describe, expect, it } from 'vitest';
import { createDefaultProject, createEmptyParameterSet } from '@/core/ir/defaults';
import type { Material } from '@/core/ir/types';
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
