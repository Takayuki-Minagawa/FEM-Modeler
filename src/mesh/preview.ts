import type {
  GeometryBody,
  MeshLocalControl,
  NamedSelection,
  ProjectIR,
} from '@/core/ir/types';
import { applyTransformToPoint } from '@/geometry/transforms';

export type MeshPreviewProvenance =
  | 'derived_from_geometry'
  | 'estimated'
  | 'measured'
  | 'not_available';

export type MeshPreviewSeverity = 'error' | 'warning' | 'info';

export interface AxisAlignedBounds {
  min: [number, number, number];
  max: [number, number, number];
}

export interface PreviewValue<T> {
  value: T;
  provenance: MeshPreviewProvenance;
}

export interface MeshPreviewNotice {
  severity: MeshPreviewSeverity;
  code: string;
  message: string;
  targetRef?: string;
}

export interface BodyMeshPreview {
  bodyId: string;
  bodyName: string;
  dimension: 1 | 2 | 3;
  bounds: PreviewValue<AxisAlignedBounds> | null;
  geometricMeasure: PreviewValue<number> | null;
  measureKind: 'length' | 'area' | 'volume';
  measureUnit: 'm' | 'm2' | 'm3';
  effectiveElementSize: PreviewValue<number> | null;
  elementCount: PreviewValue<number> | null;
  appliedLocalControlIds: string[];
}

export interface MeshQualityPreview {
  status: 'not_measured';
  provenance: 'not_available';
  measurements: null;
  targets: {
    minJacobian: number;
    maxAspectRatio: number;
    minSkewness: number;
  };
  explanation: string;
}

export interface MeshPreviewReport {
  /** A preview is a pre-mesh estimate. It must not be presented as solver mesh data. */
  basis: 'pre_mesh_estimate';
  bodies: BodyMeshPreview[];
  totalElementCount: PreviewValue<number> | null;
  quality: MeshQualityPreview;
  notices: MeshPreviewNotice[];
}

interface PrimitiveGeometry {
  bounds: AxisAlignedBounds;
  measure: number;
  dimension: 1 | 2 | 3;
}

const LARGE_ELEMENT_COUNT = 5_000_000;

export function estimateMeshPreview(ir: ProjectIR): MeshPreviewReport {
  const notices: MeshPreviewNotice[] = [];
  validateMeshControls(ir, notices);

  if (ir.geometry.bodies.length === 0) {
    notices.push({
      severity: 'warning',
      code: 'MESH_PREVIEW_NO_BODIES',
      message: 'Mesh preview requires at least one geometry body.',
    });
  }

  const bodies = ir.geometry.bodies
    .filter((body) => body.category !== 'void')
    .map((body) => previewBody(ir, body, notices));
  const counts = bodies.map((body) => body.elementCount?.value ?? null);
  const totalElementCount = counts.length > 0 && counts.every((count) => count !== null)
    ? {
        value: counts.reduce<number>((sum, count) => sum + (count ?? 0), 0),
        provenance: 'estimated' as const,
      }
    : null;

  if (totalElementCount && totalElementCount.value > LARGE_ELEMENT_COUNT) {
    notices.push({
      severity: 'warning',
      code: 'MESH_PREVIEW_LARGE_ESTIMATE',
      message: `The pre-mesh estimate is ${totalElementCount.value.toLocaleString()} elements; memory and solve time may be substantial.`,
    });
  }

  if (bodies.length > 0) {
    notices.push({
      severity: 'info',
      code: 'MESH_QUALITY_NOT_MEASURED',
      message: 'Jacobian, aspect ratio, skewness, and negative-volume checks require a generated mesh; only target values are shown.',
    });
  }

  return {
    basis: 'pre_mesh_estimate',
    bodies,
    totalElementCount,
    quality: {
      status: 'not_measured',
      provenance: 'not_available',
      measurements: null,
      targets: {
        minJacobian: ir.mesh_controls.quality_targets.min_jacobian,
        maxAspectRatio: ir.mesh_controls.quality_targets.max_aspect_ratio,
        minSkewness: ir.mesh_controls.quality_targets.min_skewness,
      },
      explanation: 'Quality metrics can only be measured after meshing; this report contains no measured mesh-quality values.',
    },
    notices,
  };
}

function previewBody(
  ir: ProjectIR,
  body: GeometryBody,
  notices: MeshPreviewNotice[],
): BodyMeshPreview {
  const primitive = geometryForBody(ir, body);
  const dimension = primitive?.dimension ?? categoryDimension(body);
  const measureKind = dimension === 1 ? 'length' : dimension === 2 ? 'area' : 'volume';
  const measureUnit = dimension === 1 ? 'm' : dimension === 2 ? 'm2' : 'm3';
  const controls = applicableLocalControls(ir, body);
  const globalSize = validPositive(ir.mesh_controls.global.global_size);
  const localSizes = controls
    .map((control) => validPositive(control.size))
    .filter((size): size is number => size !== null);
  const effectiveSize = localSizes.length > 0
    ? Math.min(...localSizes, ...(globalSize === null ? [] : [globalSize]))
    : globalSize;
  const scaledMeasure = primitive
    ? scaleMeasure(primitive.measure, dimension, body)
    : null;

  if (controls.some((control) => control.control_type !== 'local_size')) {
    notices.push({
      severity: 'info',
      code: 'MESH_PREVIEW_LOCAL_CONTROL_SIMPLIFIED',
      message: `Body "${body.name}" uses a local control whose geometric influence cannot be quantified before meshing; only its size value affects this conservative estimate.`,
      targetRef: body.id,
    });
  }

  if (!primitive) {
    notices.push({
      severity: 'warning',
      code: 'MESH_PREVIEW_GEOMETRY_UNAVAILABLE',
      message: `Bounds and element count for body "${body.name}" cannot be estimated from the available primitive metadata/topology.`,
      targetRef: body.id,
    });
  }

  const elementCount = scaledMeasure !== null && effectiveSize !== null
    ? estimateElementCount(
        scaledMeasure,
        dimension,
        effectiveSize,
        ir.mesh_controls.global.recombine_preference,
      )
    : null;

  if (elementCount !== null && elementCount < 4) {
    notices.push({
      severity: 'warning',
      code: 'MESH_PREVIEW_VERY_COARSE',
      message: `Body "${body.name}" is estimated to contain only ${elementCount} element(s); reduce the element size before relying on the solution.`,
      targetRef: body.id,
    });
  }

  return {
    bodyId: body.id,
    bodyName: body.name,
    dimension,
    bounds: primitive
      ? { value: transformBounds(primitive.bounds, body), provenance: 'derived_from_geometry' }
      : null,
    geometricMeasure: primitive
      ? {
          value: scaledMeasure!,
          provenance: 'derived_from_geometry',
        }
      : null,
    measureKind,
    measureUnit,
    effectiveElementSize: effectiveSize === null
      ? null
      : { value: effectiveSize, provenance: 'estimated' },
    elementCount: elementCount === null
      ? null
      : { value: elementCount, provenance: 'estimated' },
    appliedLocalControlIds: controls.map((control) => control.id),
  };
}

function validateMeshControls(ir: ProjectIR, notices: MeshPreviewNotice[]): void {
  const global = ir.mesh_controls.global;
  if (validPositive(global.global_size) === null) {
    notices.push({
      severity: 'warning',
      code: 'MESH_PREVIEW_GLOBAL_SIZE_MISSING',
      message: 'Set a positive global element size to estimate element counts.',
    });
  }
  if (!Number.isFinite(global.growth_rate) || global.growth_rate < 1) {
    notices.push({
      severity: 'error',
      code: 'MESH_GROWTH_RATE_INVALID',
      message: 'Mesh growth rate must be finite and at least 1.0.',
    });
  } else if (global.growth_rate > 1.5) {
    notices.push({
      severity: 'warning',
      code: 'MESH_GROWTH_RATE_AGGRESSIVE',
      message: `Growth rate ${global.growth_rate} may introduce abrupt size transitions and poor-quality elements.`,
    });
  }

  const quality = ir.mesh_controls.quality_targets;
  if (!inClosedRange(quality.min_jacobian, 0, 1)) {
    notices.push({ severity: 'error', code: 'MESH_MIN_JACOBIAN_INVALID', message: 'Minimum Jacobian target must be between 0 and 1.' });
  }
  if (!Number.isFinite(quality.max_aspect_ratio) || quality.max_aspect_ratio < 1) {
    notices.push({ severity: 'error', code: 'MESH_ASPECT_RATIO_INVALID', message: 'Maximum aspect-ratio target must be finite and at least 1.' });
  }
  if (!inClosedRange(quality.min_skewness, 0, 1)) {
    notices.push({ severity: 'error', code: 'MESH_SKEWNESS_INVALID', message: 'Skewness-quality target must be between 0 and 1.' });
  }

  for (const control of ir.mesh_controls.local) {
    const selection = ir.named_selections.find((candidate) => candidate.id === control.target_named_selection_id);
    if (!selection) {
      notices.push({
        severity: 'error',
        code: 'MESH_LOCAL_TARGET_MISSING',
        message: `Local mesh control "${control.id}" references a missing named selection.`,
        targetRef: control.id,
      });
    } else if (selection.status !== 'active' || selection.member_refs.length === 0) {
      notices.push({
        severity: 'warning',
        code: 'MESH_LOCAL_TARGET_EMPTY',
        message: `Local mesh control "${control.id}" targets an inactive or empty named selection.`,
        targetRef: control.id,
      });
    }
    if (control.size !== null && validPositive(control.size) === null) {
      notices.push({
        severity: 'error',
        code: 'MESH_LOCAL_SIZE_INVALID',
        message: `Local mesh control "${control.id}" has a non-positive or non-finite size.`,
        targetRef: control.id,
      });
    }
    if (control.control_type === 'boundary_layer'
      && (!Number.isInteger(control.layers) || (control.layers ?? 0) < 1)) {
      notices.push({
        severity: 'error',
        code: 'MESH_BOUNDARY_LAYER_COUNT_INVALID',
        message: `Boundary-layer control "${control.id}" requires at least one integer layer.`,
        targetRef: control.id,
      });
    }
  }
}

function geometryForBody(ir: ProjectIR, body: GeometryBody): PrimitiveGeometry | null {
  const vertices = ir.geometry.vertices.filter((vertex) => vertex.body_id === body.id);
  const edges = ir.geometry.edges.filter((edge) => edge.body_id === body.id);
  if (body.category === 'beam_region' && edges.length > 0) {
    const vertexById = new Map(vertices.map((vertex) => [vertex.id, vertex]));
    const length = edges.reduce((sum, edge) => {
      const start = vertexById.get(edge.vertex_ids[0]);
      const end = vertexById.get(edge.vertex_ids[1]);
      if (start && end) {
        const sx = body.transform.scale[0];
        const sy = body.transform.scale[1];
        const sz = body.transform.scale[2];
        return sum + Math.hypot(
          (end.position[0] - start.position[0]) * sx,
          (end.position[1] - start.position[1]) * sy,
          (end.position[2] - start.position[2]) * sz,
        );
      }
      return sum + (edge.length ?? 0) * Math.max(...body.transform.scale.map(Math.abs));
    }, 0);
    const bounds = boundsFromPoints(vertices.map((vertex) => vertex.position));
    return bounds && length > 0 ? { bounds, measure: unscaleMeasure(length, 1, body), dimension: 1 } : null;
  }

  const metadata = body.metadata;
  const shapeType = typeof metadata.shapeType === 'string' ? metadata.shapeType : '';
  const number = (key: string): number | null => validPositive(metadata[key]);

  switch (shapeType) {
    case 'box':
    case 'channel': {
      const width = number(shapeType === 'channel' ? 'length' : 'width');
      const height = number('height');
      const depth = number('depth');
      return width && height && depth ? centeredBox(width, height, depth) : null;
    }
    case 'plate': {
      const width = number('width');
      const depth = number('depth');
      const thickness = number('thickness');
      return width && depth && thickness ? centeredBox(width, thickness, depth) : null;
    }
    case 'plateWithHole': {
      const width = number('width');
      const depth = number('depth');
      const thickness = number('thickness');
      const radius = number('holeRadius');
      if (!width || !depth || !thickness || !radius || 2 * radius >= Math.min(width, depth)) return null;
      return {
        bounds: { min: [-width / 2, 0, -depth / 2], max: [width / 2, thickness, depth / 2] },
        measure: (width * depth - Math.PI * radius ** 2) * thickness,
        dimension: 3,
      };
    }
    case 'cylinder': {
      const radius = number('radius');
      const height = number('height');
      return radius && height ? {
        bounds: { min: [-radius, -height / 2, -radius], max: [radius, height / 2, radius] },
        measure: Math.PI * radius ** 2 * height,
        dimension: 3,
      } : null;
    }
    case 'pipe': {
      const outer = number('outerRadius');
      const inner = number('innerRadius');
      const length = number('length');
      if (!outer || !inner || !length || inner >= outer) return null;
      return {
        bounds: { min: [-outer, -length / 2, -outer], max: [outer, length / 2, outer] },
        measure: Math.PI * (outer ** 2 - inner ** 2) * length,
        dimension: 3,
      };
    }
    case 'lBracket': {
      const width = number('width');
      const height = number('height');
      const thickness = number('thickness');
      const depth = number('depth');
      if (!width || !height || !thickness || !depth || thickness >= Math.min(width, height)) return null;
      return {
        bounds: { min: [-width / 2, -height / 2, -depth / 2], max: [width / 2, height / 2, depth / 2] },
        measure: (width * thickness + height * thickness - thickness ** 2) * depth,
        dimension: 3,
      };
    }
    default: {
      if (vertices.length === 0) return null;
      const bounds = boundsFromPoints(vertices.map((vertex) => vertex.position));
      if (!bounds) return null;
      const extents = bounds.max.map((value, index) => value - bounds.min[index]) as [number, number, number];
      if (body.category === 'shell') {
        const positive = extents.filter((extent) => extent > 0).sort((a, b) => b - a);
        return positive.length >= 2 ? { bounds, measure: positive[0] * positive[1], dimension: 2 } : null;
      }
      return null;
    }
  }
}

function centeredBox(width: number, height: number, depth: number): PrimitiveGeometry {
  return {
    bounds: {
      min: [-width / 2, -height / 2, -depth / 2],
      max: [width / 2, height / 2, depth / 2],
    },
    measure: width * height * depth,
    dimension: 3,
  };
}

function applicableLocalControls(ir: ProjectIR, body: GeometryBody): MeshLocalControl[] {
  return ir.mesh_controls.local.filter((control) => {
    const selection = ir.named_selections.find((candidate) => candidate.id === control.target_named_selection_id);
    return selection ? selectionBodyIds(ir, selection).has(body.id) : false;
  });
}

function selectionBodyIds(ir: ProjectIR, selection: NamedSelection): Set<string> {
  const result = new Set<string>();
  const faces = new Map(ir.geometry.faces.map((face) => [face.id, face.body_id]));
  const edges = new Map(ir.geometry.edges.map((edge) => [edge.id, edge.body_id]));
  const vertices = new Map(ir.geometry.vertices.map((vertex) => [vertex.id, vertex.body_id]));
  const bodyIds = new Set(ir.geometry.bodies.map((body) => body.id));
  for (const memberRef of selection.member_refs) {
    if (bodyIds.has(memberRef)) result.add(memberRef);
    const bodyId = faces.get(memberRef) ?? edges.get(memberRef) ?? vertices.get(memberRef);
    if (bodyId) result.add(bodyId);
  }
  return result;
}

function categoryDimension(body: GeometryBody): 1 | 2 | 3 {
  if (body.category === 'beam_region') return 1;
  if (body.category === 'shell') return 2;
  return 3;
}

function estimateElementCount(
  measure: number,
  dimension: 1 | 2 | 3,
  size: number,
  recombine: ProjectIR['mesh_controls']['global']['recombine_preference'],
): number {
  const simplexFactor = recombine === 'all' ? 1 : dimension === 3 ? 6 : dimension === 2 ? 2 : 1;
  return Math.max(1, Math.ceil((measure / size ** dimension) * simplexFactor));
}

function scaleMeasure(measure: number, dimension: 1 | 2 | 3, body: GeometryBody): number {
  const [sx, sy, sz] = body.transform.scale.map(Math.abs);
  if (dimension === 3) return measure * sx * sy * sz;
  if (dimension === 2) {
    const scales = [sx, sy, sz].sort((a, b) => b - a);
    return measure * scales[0] * scales[1];
  }
  return measure * Math.max(sx, sy, sz);
}

function unscaleMeasure(measure: number, dimension: 1 | 2 | 3, body: GeometryBody): number {
  const scaledUnit = scaleMeasure(1, dimension, body);
  return scaledUnit > 0 ? measure / scaledUnit : measure;
}

function transformBounds(bounds: AxisAlignedBounds, body: GeometryBody): AxisAlignedBounds {
  const corners: [number, number, number][] = [];
  for (const x of [bounds.min[0], bounds.max[0]]) {
    for (const y of [bounds.min[1], bounds.max[1]]) {
      for (const z of [bounds.min[2], bounds.max[2]]) {
        corners.push(transformPoint([x, y, z], body));
      }
    }
  }
  return boundsFromPoints(corners) ?? bounds;
}

function transformPoint(point: [number, number, number], body: GeometryBody): [number, number, number] {
  return applyTransformToPoint(point, body.transform);
}

function boundsFromPoints(points: [number, number, number][]): AxisAlignedBounds | null {
  if (points.length === 0 || points.some((point) => point.some((value) => !Number.isFinite(value)))) return null;
  const min: [number, number, number] = [...points[0]];
  const max: [number, number, number] = [...points[0]];
  for (const point of points.slice(1)) {
    for (let index = 0; index < 3; index += 1) {
      min[index] = Math.min(min[index], point[index]);
      max[index] = Math.max(max[index], point[index]);
    }
  }
  return { min, max };
}

function validPositive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function inClosedRange(value: number, lower: number, upper: number): boolean {
  return Number.isFinite(value) && value >= lower && value <= upper;
}
