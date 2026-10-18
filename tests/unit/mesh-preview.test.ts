import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '@/core/ir/defaults';
import { generateShape } from '@/geometry/primitives/generators';
import { estimateMeshPreview } from '@/mesh/preview';
import { validateCommon } from '@/validation/rules/common';

describe('mesh preview estimator', () => {
  it('labels primitive bounds as derived and element counts as estimates', () => {
    const ir = createDefaultProject();
    const shape = generateShape({ shapeType: 'box', width: 2, height: 2, depth: 2 }, 'Cube');
    ir.geometry.bodies.push(shape.body);
    ir.geometry.faces.push(...shape.faces);
    ir.geometry.edges.push(...shape.edges);
    ir.geometry.vertices.push(...shape.vertices);
    ir.mesh_controls.global.global_size = 1;

    const report = estimateMeshPreview(ir);

    expect(report.basis).toBe('pre_mesh_estimate');
    expect(report.bodies[0].bounds).toEqual({
      value: { min: [-1, -1, -1], max: [1, 1, 1] },
      provenance: 'derived_from_geometry',
    });
    expect(report.bodies[0].geometricMeasure).toEqual({
      value: 8,
      provenance: 'derived_from_geometry',
    });
    expect(report.bodies[0].elementCount).toEqual({ value: 48, provenance: 'estimated' });
    expect(report.totalElementCount).toEqual({ value: 48, provenance: 'estimated' });
    expect(report.quality.status).toBe('not_measured');
    expect(report.quality.measurements).toBeNull();
    expect(report.notices.some((notice) => notice.code === 'MESH_QUALITY_NOT_MEASURED')).toBe(true);
  });

  it('uses the smallest applicable local size conservatively and honors body scale', () => {
    const ir = createDefaultProject();
    const shape = generateShape({ shapeType: 'box', width: 1, height: 1, depth: 1 }, 'Scaled');
    shape.body.transform.scale = [2, 1, 1];
    ir.geometry.bodies.push(shape.body);
    ir.geometry.faces.push(...shape.faces);
    ir.geometry.edges.push(...shape.edges);
    ir.geometry.vertices.push(...shape.vertices);
    ir.named_selections.push({
      id: 'ns_face',
      name: 'refined_face',
      target_dimension: 2,
      entity_type: 'face',
      member_refs: [shape.faces[0].id],
      color: '#fff',
      description: '',
      created_by: 'user',
      status: 'active',
      usages: ['mesh_control'],
    });
    ir.mesh_controls.global.global_size = 1;
    ir.mesh_controls.local.push({
      id: 'mesh_local',
      target_named_selection_id: 'ns_face',
      control_type: 'local_size',
      size: 0.5,
      layers: null,
      bias: null,
      transfinite_hint: false,
      boundary_layer_hint: false,
      priority: 1,
    });

    const body = estimateMeshPreview(ir).bodies[0];

    expect(body.bounds?.value).toEqual({ min: [-1, -0.5, -0.5], max: [1, 0.5, 0.5] });
    expect(body.geometricMeasure?.value).toBe(2);
    expect(body.effectiveElementSize?.value).toBe(0.5);
    expect(body.elementCount?.value).toBe(96);
    expect(body.appliedLocalControlIds).toEqual(['mesh_local']);
    expect(validateCommon(ir).some((issue) => issue.code === 'UNUSED_NS' && issue.target_ref === 'ns_face')).toBe(false);
    for (const status of ['stale', 'unresolved'] as const) {
      ir.named_selections[0].status = status;
      const inactive = estimateMeshPreview(ir);
      expect(inactive.bodies[0].effectiveElementSize?.value).toBe(1);
      expect(inactive.bodies[0].elementCount?.value).toBe(12);
      expect(inactive.bodies[0].appliedLocalControlIds).toEqual([]);
      expect(inactive.notices.some((notice) => notice.code === 'MESH_LOCAL_TARGET_EMPTY')).toBe(true);
    }
  });

  it('matches generated holed plate bounds through a body transform', () => {
    const ir = createDefaultProject();
    const shape = generateShape({ shapeType: 'plateWithHole', width: 4, depth: 3, thickness: 0.2, holeRadius: 0.5 });
    shape.body.transform.position = [2, 3, 4];
    shape.body.transform.scale = [1, 2, 1];
    ir.geometry.bodies.push(shape.body);
    shape.threeGeometry.computeBoundingBox();
    const rendered = shape.threeGeometry.boundingBox!;
    const bounds = estimateMeshPreview(ir).bodies[0].bounds!.value;
    for (const [axis, key] of ['x', 'y', 'z'].entries()) {
      const component = key as 'x' | 'y' | 'z';
      expect(bounds.min[axis]).toBeCloseTo(rendered.min[component] * shape.body.transform.scale[axis] + shape.body.transform.position[axis], 6);
      expect(bounds.max[axis]).toBeCloseTo(rendered.max[component] * shape.body.transform.scale[axis] + shape.body.transform.position[axis], 6);
    }
  });

  it.each([Number.MIN_VALUE, 1e-100, 1e-6])('does not expose an unsafe element estimate for size %s', (size) => {
    const ir = createDefaultProject();
    ir.geometry.bodies.push(generateShape({ shapeType: 'box', width: 1, height: 1, depth: 1 }).body);
    ir.mesh_controls.global.global_size = size;
    const report = estimateMeshPreview(ir);
    expect(report.bodies[0].elementCount).toBeNull();
    expect(report.totalElementCount).toBeNull();
    expect(report.notices.some((notice) => notice.code === 'MESH_PREVIEW_ESTIMATE_LIMIT')).toBe(true);
  });

  it('reports non-finite transformed geometry without falling back to local bounds', () => {
    const ir = createDefaultProject();
    const shape = generateShape({ shapeType: 'box', width: 4, height: 1, depth: 1 });
    shape.body.transform.scale = [Number.MAX_VALUE, 2, 2];
    ir.geometry.bodies.push(shape.body);
    ir.mesh_controls.global.global_size = 1;
    const body = estimateMeshPreview(ir).bodies[0];
    expect(body.bounds).toBeNull(); expect(body.geometricMeasure).toBeNull(); expect(body.elementCount).toBeNull();
  });

  it('omits a total that exceeds safe integers even when each body count is representable', () => {
    const ir = createDefaultProject();
    for (let i = 0; i < 2; i += 1) ir.geometry.bodies.push(generateShape({ shapeType: 'box', width: 1, height: 1, depth: 1 }).body);
    ir.mesh_controls.global.global_size = Math.cbrt(6 / 8e15);
    const report = estimateMeshPreview(ir);
    expect(report.bodies.every((body) => Number.isSafeInteger(body.elementCount?.value))).toBe(true);
    expect(report.totalElementCount).toBeNull();
    expect(report.notices.some((notice) => notice.code === 'MESH_PREVIEW_ESTIMATE_LIMIT')).toBe(true);
  });

  it('interprets body rotations in degrees when deriving world-space bounds', () => {
    const ir = createDefaultProject();
    const shape = generateShape({ shapeType: 'box', width: 2, height: 1, depth: 1 }, 'Rotated');
    shape.body.transform.rotation = [0, 0, 90];
    ir.geometry.bodies.push(shape.body);
    ir.mesh_controls.global.global_size = 0.5;

    const bounds = estimateMeshPreview(ir).bodies[0].bounds?.value;

    expect(bounds?.min[0]).toBeCloseTo(-0.5);
    expect(bounds?.max[0]).toBeCloseTo(0.5);
    expect(bounds?.min[1]).toBeCloseTo(-1);
    expect(bounds?.max[1]).toBeCloseTo(1);
  });

  it('scales fallback shell area along the shell span axes', () => {
    const ir = createDefaultProject();
    ir.geometry.bodies.push({
      id: 'shell_xz',
      name: 'X-Z shell',
      category: 'shell',
      visible: true,
      locked: false,
      color: '#fff',
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [2, 2, 1] },
      topology_ref: '',
      metadata: {},
    });
    ir.geometry.vertices.push(
      { id: 'v1', name: 'v1', body_id: 'shell_xz', position: [-1, 0, -0.5] },
      { id: 'v2', name: 'v2', body_id: 'shell_xz', position: [1, 0, -0.5] },
      { id: 'v3', name: 'v3', body_id: 'shell_xz', position: [1, 0, 0.5] },
      { id: 'v4', name: 'v4', body_id: 'shell_xz', position: [-1, 0, 0.5] },
    );
    ir.mesh_controls.global.global_size = 1;

    const body = estimateMeshPreview(ir).bodies[0];

    expect(body.geometricMeasure?.value).toBe(4);
    expect(body.elementCount?.value).toBe(8);
    expect(body.bounds?.value).toEqual({ min: [-2, 0, -0.5], max: [2, 0, 0.5] });
  });

  it('reports invalid preflight controls without inventing quality measurements', () => {
    const ir = createDefaultProject();
    const shape = generateShape({ shapeType: 'box', width: 1, height: 1, depth: 1 });
    ir.geometry.bodies.push(shape.body);
    ir.mesh_controls.global.global_size = null;
    ir.mesh_controls.global.growth_rate = 0.8;
    ir.mesh_controls.quality_targets.max_aspect_ratio = 0.5;
    ir.mesh_controls.local.push({
      id: 'bad_layer',
      target_named_selection_id: 'missing',
      control_type: 'boundary_layer',
      size: -1,
      layers: 0,
      bias: null,
      transfinite_hint: false,
      boundary_layer_hint: true,
      priority: 1,
    });

    const report = estimateMeshPreview(ir);
    const codes = new Set(report.notices.map((notice) => notice.code));

    expect(report.bodies[0].elementCount).toBeNull();
    expect(report.totalElementCount).toBeNull();
    expect(report.quality.provenance).toBe('not_available');
    for (const code of [
      'MESH_PREVIEW_GLOBAL_SIZE_MISSING',
      'MESH_GROWTH_RATE_INVALID',
      'MESH_ASPECT_RATIO_INVALID',
      'MESH_LOCAL_TARGET_MISSING',
      'MESH_LOCAL_SIZE_INVALID',
      'MESH_BOUNDARY_LAYER_COUNT_INVALID',
    ]) expect(codes.has(code)).toBe(true);
  });
});
