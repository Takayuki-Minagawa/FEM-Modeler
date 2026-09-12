import type { DomainType, ProjectIR } from '@/core/ir/types';
import { generateShape } from '@/geometry/primitives/generators';
import type { ShapeParams } from '@/geometry/primitives/types';
import { applyTemplate } from '@/lib/project-templates';
import { useAppStore } from '@/state/store';

function template(domain: DomainType): ProjectIR {
  useAppStore.getState().createProject(`${domain} analytic benchmark`, domain);
  applyTemplate(domain, 'en');
  return structuredClone(useAppStore.getState().ir);
}

function replaceShape(ir: ProjectIR, parameters: ShapeParams): void {
  const shape = generateShape(parameters, 'Analytic benchmark geometry');
  const oldFaces = new Map(ir.geometry.faces.map((face) => [face.id, face.name]));
  ir.geometry = { ...ir.geometry, bodies: [shape.body], faces: shape.faces, edges: shape.edges, vertices: shape.vertices };
  for (const selection of ir.named_selections) {
    if (selection.entity_type === 'body') selection.member_refs = [shape.body.id];
    if (selection.entity_type === 'face') selection.member_refs = selection.member_refs.map((ref) => shape.faces.find((face) => face.name === oldFaces.get(ref))!.id);
    if (selection.entity_type === 'edge') selection.member_refs = shape.edges.map((edge) => edge.id);
    if (selection.entity_type === 'vertex') {
      const vertices = shape.vertices;
      const minX = Math.min(...vertices.map((vertex) => vertex.position[0]));
      const maxX = Math.max(...vertices.map((vertex) => vertex.position[0]));
      const maxY = Math.max(...vertices.map((vertex) => vertex.position[1]));
      const isLoad = ir.loads.some((load) => load.target_named_selection_id === selection.id);
      const selected = isLoad ? vertices.filter((vertex) => vertex.position[1] === maxY)
        : selection.name === 'left_pin' ? vertices.filter((vertex) => vertex.position[0] === minX && vertex.position[1] === 0)
          : selection.name === 'right_roller' ? vertices.filter((vertex) => vertex.position[0] === maxX && vertex.position[1] === 0)
            : vertices.filter((vertex) => vertex.position[1] === 0);
      selection.member_refs = selected.map((vertex) => vertex.id);
    }
  }
}

export function analyticBenchmark(domain: DomainType): ProjectIR {
  const ir = template(domain);
  if (domain === 'frame') {
    replaceShape(ir, { shapeType: 'frame2d', spanX: 2, spanY: 3, columns: 2, floors: 1 });
    ir.loads[0].direction = [0, -1, 0];
    ir.loads[0].magnitude = 1000;
    ir.sections[0].area = 0.01;
    ir.materials[0].parameter_set.young_modulus.value = 200e9;
  } else if (domain === 'truss') {
    replaceShape(ir, { shapeType: 'truss2d', span: 2, height: 1, divisions: 2 });
    ir.loads[0].magnitude = 1000;
    ir.sections[0].area = 0.01;
    ir.materials[0].parameter_set.young_modulus.value = 200e9;
  } else if (domain === 'thermal') {
    replaceShape(ir, { shapeType: 'box', width: 1, height: 0.2, depth: 0.2 });
    ir.materials[0].parameter_set.thermal_conductivity.value = 10;
    ir.boundary_conditions[0].values.scalar = 300;
    ir.loads[0].magnitude = 100;
    ir.mesh_controls.global.global_size = 0.1;
    const source = { ...ir.loads[0], id: 'benchmark_generation', name: 'Uniform volumetric heat', load_type: 'volumetric_heat' as const, application_mode: 'per_volume' as const, magnitude: 100, target_named_selection_id: ir.named_selections.find((selection) => selection.entity_type === 'body')!.id };
    ir.loads.push(source);
    ir.analysis_cases[0].participating_load_ids.push(source.id);
    ir.mesh_controls.global.element_order = 2;
  } else if (domain === 'solid') {
    replaceShape(ir, { shapeType: 'box', width: 0.2, height: 1, depth: 0.2 });
    ir.materials[0].parameter_set.young_modulus.value = 200e9;
    ir.materials[0].parameter_set.poisson_ratio.value = 0;
    ir.loads[0].magnitude = 1e6;
    ir.mesh_controls.global.global_size = 0.1;
  } else if (domain === 'fluid') {
    replaceShape(ir, { shapeType: 'channel', length: 8, height: 1, depth: 0.1 });
    // Very small Re -> fully developed planar Poiseuille profile after the entrance.
    ir.boundary_conditions.find((bc) => bc.bc_type === 'velocity_inlet')!.values.vector = [0.001, 0, 0];
    ir.materials[0].parameter_set.kinematic_viscosity.value = 0.01;
    ir.materials[0].parameter_set.dynamic_viscosity.value = 0.01 * (ir.materials[0].parameter_set.density.value as number);
    ir.mesh_controls.global.global_size = 0.05;
  }
  return ir;
}
