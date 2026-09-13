import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { scopeProjectForAnalysisCaseValidation } from '@/export/compiler/capabilities';
import type { ProjectIR, ResultIR, SolverTargetName } from './types';
import { generateId } from './id-generator';

/** Change when the canonical input projection changes, independently of file migrations. */
export const INPUT_CONTRACT_VERSION = 'fem-modeler-input-v1';

export interface ExportProvenance {
  project_id: string;
  analysis_case_id: string;
  export_target: SolverTargetName;
  input_fingerprint: string;
  comparison_fingerprint: string;
  run_id: string;
  model_revision: number;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error('Solver input contains a non-finite number.');
    }
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

function byId<T extends { id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.id.localeCompare(b.id, 'en'));
}

function omit<T extends object>(value: T, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
}

/** SI solver inputs only. UI state, result artifacts and revision counters are excluded. */
export function solverInputProjection(ir: ProjectIR, target: SolverTargetName, caseId: string, omitMesh = false) {
  const scopeInput = omitMesh ? { ...ir, mesh_controls: { ...ir.mesh_controls, local: [] } } : ir;
  const scoped = scopeProjectForAnalysisCaseValidation(scopeInput, caseId);
  const analysisCase = scoped.analysis_cases[0];
  const solver = ir.solver_targets.find((item) => item.target_name === target);
  return {
    contract: INPUT_CONTRACT_VERSION,
    target,
    // Names of faces are stable generator roles used by the current exporters.
    geometry: {
      bodies: byId(scoped.geometry.bodies).map((body) => omit(body, ['name', 'visible', 'locked', 'color'])),
      faces: byId(scoped.geometry.faces),
      edges: byId(scoped.geometry.edges).map((edge) => omit(edge, ['name'])),
      vertices: byId(scoped.geometry.vertices).map((vertex) => omit(vertex, ['name'])),
      reference_frames: byId(scoped.geometry.reference_frames).map((frame) => omit(frame, ['name'])),
    },
    assets: byId(scoped.assets).map((asset) => ({
      id: asset.id, kind: asset.kind, content_hash: asset.content_hash,
      scale_to_meters: asset.scale_to_meters, byte_length: asset.byte_length,
      ...(asset.cad_source ? { cad_source: { format: asset.cad_source.format, content_hash: asset.cad_source.content_hash, byte_length: asset.cad_source.byte_length } } : {}),
    })),
    selections: byId(scoped.named_selections).map((selection) => ({
      id: selection.id, target_dimension: selection.target_dimension,
      entity_type: selection.entity_type, member_refs: [...selection.member_refs].sort(), status: selection.status,
    })),
    materials: byId(scoped.materials).map((material) => ({
      id: material.id, class: material.class, physical_model: material.physical_model,
      parameters: Object.fromEntries(Object.entries(material.parameter_set).map(([key, entry]) => [key, entry.value])),
    })),
    material_assignments: byId(scoped.material_assignments),
    sections: byId(scoped.sections).map((section) => omit(section, ['name'])),
    section_assignments: byId(scoped.section_assignments),
    boundary_conditions: byId(scoped.boundary_conditions).map((condition) => omit(condition, ['name', 'notes', 'status'])),
    loads: byId(scoped.loads).map((load) => omit(load, ['name', 'status', 'load_case'])),
    initial_conditions: byId(scoped.initial_conditions).map((condition) => omit(condition, ['name', 'status'])),
    analysis: omit(analysisCase, omitMesh ? ['name', 'active', 'mesh_policy_ref'] : ['name', 'active']),
    solver_options: solver?.solver_options ?? {},
    ...(omitMesh ? {} : { mesh_controls: scoped.mesh_controls }),
  };
}

function fingerprint(ir: ProjectIR, target: SolverTargetName, caseId: string, omitMesh: boolean): string {
  return `sha256:${bytesToHex(sha256(new TextEncoder().encode(canonicalJson(solverInputProjection(ir, target, caseId, omitMesh)))))}`;
}

export function inputFingerprint(ir: ProjectIR, target: SolverTargetName, caseId: string): string {
  return fingerprint(ir, target, caseId, false);
}

/** Equal only when geometry, physics and evaluation requests match, excluding meshing controls. */
export function comparisonFingerprint(ir: ProjectIR, target: SolverTargetName, caseId: string): string {
  return fingerprint(ir, target, caseId, true);
}

export function createExportProvenance(ir: ProjectIR, target: SolverTargetName, caseId?: string): ExportProvenance {
  const id = caseId ?? ir.analysis_cases.find((item) => item.active)?.id;
  if (!id) throw new Error('An analysis case is required for result provenance.');
  return {
    project_id: ir.meta.project_id, analysis_case_id: id, export_target: target,
    input_fingerprint: inputFingerprint(ir, target, id),
    comparison_fingerprint: comparisonFingerprint(ir, target, id),
    run_id: generateId('run'), model_revision: ir.validation.model_revision,
  };
}

export function resultImportExpectations(ir: ProjectIR, target: SolverTargetName, caseId: string) {
  return {
    expectedProjectId: ir.meta.project_id,
    expectedInputFingerprint: inputFingerprint(ir, target, caseId),
    expectedComparisonFingerprint: comparisonFingerprint(ir, target, caseId),
  };
}

export function resultMatchesInput(ir: ProjectIR, result: ResultIR): boolean {
  const metadata = result.metadata;
  if (metadata.provenance_verified !== true || metadata.project_id !== ir.meta.project_id
    || metadata.export_target !== result.solver_target || metadata.analysis_case_id !== result.analysis_case_id
    || typeof metadata.run_id !== 'string' || !metadata.run_id.trim() || metadata.run_id.length > 256
    || (result.mesh && (result.mesh.source.solver !== result.solver_target
      || result.mesh.source.input_fingerprint !== metadata.input_fingerprint))) return false;
  try {
    return result.metadata.input_fingerprint === inputFingerprint(ir, result.solver_target, result.analysis_case_id);
  } catch {
    return false;
  }
}
