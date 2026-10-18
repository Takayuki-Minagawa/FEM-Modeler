import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { ProjectIR, ValidationItem, ValidationSeverity, ValidationState } from '@/core/ir/types';
import { parseNativeShapeMetadata } from '@/core/ir/schema/shapes';
import { nativeShapeBounds } from '@/geometry/native-bounds';
import { applyTransformToPoint, type Vector3Tuple } from '@/geometry/transforms';
import { modelIssuesEn, type ModelIssueCode } from './validation-copy';

function canonical(value: unknown): string {
  if (typeof value === 'number' && !Number.isFinite(value)) return JSON.stringify({ invalid_number: String(value) });
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().filter(key => record[key] !== undefined).map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
}

/** Analysis cases, conditions, results, and presentation state do not define a component model. */
export function modelInputFingerprint(ir: ProjectIR): string {
  const input = {
    contract: 'fem-modeler-model-check-v1', project_id: ir.meta.project_id, units: ir.units.value_basis,
    geometry: ir.geometry,
    assets: ir.assets.map(asset => ({
      ...Object.fromEntries(Object.entries(asset).filter(([key]) => key !== 'data' && key !== 'cad_source')),
      ...(asset.cad_source ? { cad_source: { format: asset.cad_source.format, content_hash: asset.cad_source.content_hash, byte_length: asset.cad_source.byte_length } } : {}),
    })),
    selections: ir.named_selections, materials: ir.materials, material_assignments: ir.material_assignments,
    sections: ir.sections, section_assignments: ir.section_assignments,
  };
  return `sha256:${bytesToHex(sha256(new TextEncoder().encode(canonical(input))))}`;
}

export function modelValidationRunStatus(ir: ProjectIR): 'not_run' | 'stale' | 'current' {
  const state = ir.validation;
  if (!state.last_run_at || state.model_context?.kind !== 'model') return 'not_run';
  return state.validated_revision === state.model_revision && state.model_context.input_fingerprint === modelInputFingerprint(ir) ? 'current' : 'stale';
}

const finite = (values: readonly number[]) => values.every(Number.isFinite);
const renderable = (values: readonly number[]) => values.every(value => Number.isFinite(value) && Number.isFinite(Math.fround(value)) && (value === 0 || Math.fround(value) !== 0));
const idsOf = (items: readonly { id: string }[]) => new Set(items.map(item => item.id));

/** Handoff consistency only: no material, support, load, solver, or analysis case is required. */
export function validateModel(ir: ProjectIR): ValidationState {
  const items: ValidationItem[] = [];
  const add = (severity: ValidationSeverity, code: ModelIssueCode, target_ref: string, detail = '') => {
    const [title, message, suggested_fix] = modelIssuesEn[code];
    items.push({ id: `model_${items.length}_${code}`, severity, code, title, message: `${message}${detail ? ` ${detail}` : ''}`, target_ref, suggested_fix, dismissible: severity !== 'error', status: 'open' });
  };
  const check = (source: string, field: string, value: string, valid: Set<string>) => {
    if (!valid.has(value)) add('error', 'MODEL_REFERENCE', source, `${field}: ${value || '∅'}`);
  };
  const bodies = new Map(ir.geometry.bodies.map(body => [body.id, body]));
  const vertices = new Map(ir.geometry.vertices.map(vertex => [vertex.id, vertex]));
  const assets = new Map(ir.assets.map(asset => [asset.id, asset]));
  const entityIds = {
    body: idsOf(ir.geometry.bodies), face: idsOf(ir.geometry.faces), edge: idsOf(ir.geometry.edges), vertex: idsOf(ir.geometry.vertices),
  };
  const geometryIds = new Set(Object.values(entityIds).flatMap(ids => [...ids]));
  const frameIds = idsOf(ir.geometry.reference_frames);
  const attachableIds = new Set([...geometryIds, ...frameIds]);
  const selectionIds = idsOf(ir.named_selections);
  const materialIds = idsOf(ir.materials);
  const sectionIds = idsOf(ir.sections);
  const registered = new Set([ir.meta.project_id]);
  for (const collection of [ir.geometry.bodies, ir.geometry.faces, ir.geometry.edges, ir.geometry.vertices, ir.geometry.reference_frames,
    ir.geometry.geometry_parameters, ir.assets, ir.named_selections, ir.materials, ir.material_assignments, ir.sections, ir.section_assignments]) {
    for (const item of collection) {
      if (!item.id || registered.has(item.id)) add('error', 'MODEL_DUPLICATE_ID', item.id);
      registered.add(item.id);
    }
  }
  if (bodies.size === 0) add('info', 'MODEL_EMPTY', 'geometry');
  if (ir.units.value_basis !== 'SI') add('error', 'MODEL_UNITS', 'units');

  for (const body of ir.geometry.bodies) {
    const transformValid = finite([...body.transform.position, ...body.transform.rotation, ...body.transform.scale]) && body.transform.scale.every(value => value !== 0);
    if (!transformValid) add('error', 'MODEL_TRANSFORM', body.id);
    const imported = body.metadata.shapeType === 'imported_stl' || body.metadata.shapeType === 'imported_cad';
    const asset = body.asset_ref ? assets.get(body.asset_ref) : undefined;
    if ((imported || body.asset_ref) && !asset) add('error', 'MODEL_ASSET', body.id);
    if (body.metadata.shapeType === 'imported_cad' && asset && !asset.cad_source) add('warning', 'MODEL_CAD_SOURCE', body.id);
    if (!imported) {
      try {
        const shape = parseNativeShapeMetadata(body.metadata);
        if (Object.values(shape).some(value => typeof value === 'number' && (!Number.isFinite(Math.fround(value)) || (value !== 0 && Math.fround(value) === 0)))) throw new Error('Unrepresentable dimension');
      } catch { add('error', 'MODEL_SHAPE', body.id); }
    }
    const bounds = asset?.bounds ?? nativeShapeBounds(body.metadata);
    if (transformValid && bounds) {
      const corners = [bounds.min[0], bounds.max[0]].flatMap(x => [bounds.min[1], bounds.max[1]].flatMap(y => [bounds.min[2], bounds.max[2]].map(z => [x, y, z] as Vector3Tuple)));
      if (corners.some(point => !renderable(applyTransformToPoint(point, body.transform)))) add('error', 'MODEL_COORDINATE', body.id);
    }
  }
  for (const asset of ir.assets) {
    const validBounds = finite([...asset.bounds.min, ...asset.bounds.max]) && asset.bounds.min.every((value, index) => value <= asset.bounds.max[index]);
    if (!validBounds || !asset.diagnostics.finite_coordinates || !Number.isFinite(asset.scale_to_meters) || asset.scale_to_meters <= 0) add('error', 'MODEL_ASSET_DATA', asset.id);
    if (asset.diagnostics.degenerate_triangles > 0 || asset.diagnostics.watertight === false || asset.diagnostics.manifold === false) add('warning', 'MODEL_ASSET_SURFACE', asset.id);
  }
  const worldVertices = new Map<string, Vector3Tuple>();
  for (const vertex of ir.geometry.vertices) {
    check(vertex.id, 'body_id', vertex.body_id, entityIds.body);
    const body = bodies.get(vertex.body_id);
    const position = body ? applyTransformToPoint(vertex.position, body.transform) : vertex.position;
    worldVertices.set(vertex.id, position);
    if (!renderable(position) || !finite(vertex.position)) add('error', 'MODEL_COORDINATE', vertex.id);
  }
  for (const edge of ir.geometry.edges) {
    check(edge.id, 'body_id', edge.body_id, entityIds.body);
    for (const vertexId of edge.vertex_ids) check(edge.id, 'vertex_ids', vertexId, entityIds.vertex);
    const start = vertices.get(edge.vertex_ids[0]);
    const end = vertices.get(edge.vertex_ids[1]);
    const a = worldVertices.get(edge.vertex_ids[0]);
    const b = worldVertices.get(edge.vertex_ids[1]);
    const length = a && b ? Math.hypot(...a.map((value, index) => value - b[index])) : undefined;
    if ((start && end && (start.body_id !== edge.body_id || end.body_id !== edge.body_id))
      || (length !== undefined && (!Number.isFinite(length) || length === 0))
      || (edge.length !== undefined && (!Number.isFinite(edge.length) || edge.length <= 0))) add('error', 'MODEL_EDGE', edge.id);
  }
  for (const face of ir.geometry.faces) {
    check(face.id, 'body_id', face.body_id, entityIds.body);
    const asset = assets.get(bodies.get(face.body_id)?.asset_ref ?? '');
    if ((face.normal && (!finite(face.normal) || Math.hypot(...face.normal) === 0))
      || (face.area !== undefined && (!Number.isFinite(face.area) || face.area < 0))
      || face.triangle_indices.some(index => !Number.isInteger(index) || index < 0 || (asset && index >= asset.triangle_count))) add('error', 'MODEL_FACE', face.id);
  }
  const frames = new Map(ir.geometry.reference_frames.map(frame => [frame.id, frame]));
  for (const frame of frames.values()) {
    if (frame.attached_to) check(frame.id, 'attached_to', frame.attached_to, attachableIds);
    const axes = [frame.axis_x, frame.axis_y, frame.axis_z];
    const normalized = axes.map(axis => { const length = Math.hypot(...axis); return axis.map(value => value / length); });
    const [a, b, c] = normalized;
    const determinant = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
    if (!renderable(frame.origin) || !axes.every(finite) || !Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) add('error', 'MODEL_FRAME', frame.id);
    const visited = new Set([frame.id]);
    let attached = frame.attached_to;
    while (attached && frames.has(attached)) {
      if (visited.has(attached)) { add('error', 'MODEL_FRAME_CYCLE', frame.id); break; }
      visited.add(attached); attached = frames.get(attached)?.attached_to;
    }
  }
  for (const selection of ir.named_selections) {
    if (selection.status !== 'active') add('warning', 'MODEL_SELECTION_STALE', selection.id);
    if (!selection.member_refs.length) add('info', 'MODEL_SELECTION_EMPTY', selection.id);
    const type = selection.entity_type;
    if (type !== 'body' && type !== 'face' && type !== 'edge' && type !== 'vertex') { add('info', 'MODEL_SELECTION_EXTERNAL', selection.id); continue; }
    const dimension = { body: 3, face: 2, edge: 1, vertex: 0 }[type];
    if (selection.target_dimension !== dimension || selection.member_refs.some(ref => !entityIds[type].has(ref)) || new Set(selection.member_refs).size !== selection.member_refs.length) add('error', 'MODEL_SELECTION', selection.id);
  }
  for (const assignment of ir.material_assignments) {
    check(assignment.id, 'material_id', assignment.material_id, materialIds);
    check(assignment.id, 'target_named_selection_id', assignment.target_named_selection_id, selectionIds);
  }
  for (const section of ir.sections) {
    if (section.material_id) check(section.id, 'material_id', section.material_id, materialIds);
    if (section.orientation_ref) check(section.id, 'orientation_ref', section.orientation_ref, frameIds);
    if (![...Object.values(section.dimensions), section.area, section.inertia_y, section.inertia_z, section.torsion_constant, section.thickness].every(value => value === null || Number.isFinite(value))) add('error', 'MODEL_PROPERTY', section.id);
  }
  for (const assignment of ir.section_assignments) {
    check(assignment.id, 'section_id', assignment.section_id, sectionIds);
    check(assignment.id, 'target_named_selection_id', assignment.target_named_selection_id, selectionIds);
  }
  for (const material of ir.materials) if (Object.values(material.parameter_set).some(property => property.value !== null && !Number.isFinite(property.value))) add('error', 'MODEL_PROPERTY', material.id);
  for (const parameter of ir.geometry.geometry_parameters) if (!Number.isFinite(parameter.value)) add('error', 'MODEL_PROPERTY', parameter.id);
  return {
    last_run_at: new Date().toISOString(), model_revision: ir.validation.model_revision, validated_revision: ir.validation.model_revision,
    model_context: { kind: 'model', input_fingerprint: modelInputFingerprint(ir) },
    summary: { error_count: items.filter(item => item.severity === 'error').length, warning_count: items.filter(item => item.severity === 'warning').length, info_count: items.filter(item => item.severity === 'info').length }, items,
  };
}
