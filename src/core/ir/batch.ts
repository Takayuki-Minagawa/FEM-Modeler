import type { AnalysisCase, ProjectIR } from './types';
import { generateId } from './id-generator';
import { uniqueEntityName } from './names';
import { getParticipationMode, participationUpdate, PARTICIPATION_FIELDS, type ParticipationField } from './participation';
import type { BatchChange } from './model-batch';
export { assignmentIssue, planAssignments } from './model-batch';
export type { AssignmentKind, BatchChange } from './model-batch';
import { scopeProjectForAnalysisCaseValidation } from '@/export/compiler/capabilities';

export type DuplicateKind = 'material' | 'section' | 'boundary_condition' | 'load' | 'analysis_case';
const collections = {
  material: 'materials', section: 'sections', boundary_condition: 'boundary_conditions',
  load: 'loads', analysis_case: 'analysis_cases',
} as const;
const participationCollections = {
  participating_material_ids: 'materials', participating_section_ids: 'sections',
  participating_bc_ids: 'boundary_conditions', participating_load_ids: 'loads', participating_ic_ids: 'initial_conditions',
} as const;

/** Resolve "all" using the same domain/target rules as validation and export. */
function resolvedIds(ir: ProjectIR, analysisCase: AnalysisCase, field: ParticipationField): string[] {
  if (getParticipationMode(analysisCase, field) === 'none') return [];
  if (getParticipationMode(analysisCase, field) === 'explicit') return [...analysisCase[field]];
  return scopeProjectForAnalysisCaseValidation(ir, analysisCase.id)[participationCollections[field]].map((item) => item.id);
}

function freezeAll(ir: ProjectIR, cases: AnalysisCase[], field: ParticipationField) {
  for (const analysisCase of cases) {
    if (getParticipationMode(analysisCase, field) === 'all') {
      Object.assign(analysisCase, participationUpdate(analysisCase, field, resolvedIds(ir, analysisCase, field)));
    }
  }
}

/** Copies never steal assignments or silently add a condition to an existing case. */
export function planDuplicate(ir: ProjectIR, kind: DuplicateKind, sourceId: string, copyLabel: string): BatchChange & { createdId: string; name: string } {
  const collection = collections[kind];
  const source = ir[collection].find((item) => item.id === sourceId);
  if (!source) throw new Error('bulk.missingEntity');
  const copy = { ...structuredClone(source), id: generateId(kind), name: uniqueEntityName(`${source.name} ${copyLabel}`, ir[collection]) };
  const patch: Partial<ProjectIR> = { [collection]: [...ir[collection], copy] };
  if (kind === 'analysis_case') {
    const analysisCase = copy as AnalysisCase;
    analysisCase.active = false;
    for (const field of PARTICIPATION_FIELDS) {
      Object.assign(analysisCase, participationUpdate(analysisCase, field, resolvedIds(ir, source as AnalysisCase, field)));
    }
  } else if (kind === 'load' || kind === 'boundary_condition') {
    patch.analysis_cases = structuredClone(ir.analysis_cases);
    freezeAll(ir, patch.analysis_cases, kind === 'load' ? 'participating_load_ids' : 'participating_bc_ids');
  }
  return { patch, createdId: copy.id, name: copy.name };
}

export interface LoadScaleDifference { caseId: string; loadId: string; before: number; after: number; copied: boolean }

/** One multiplier per unique load. Shared loads are copied only for the selected cases. */
export function planLoadScaling(ir: ProjectIR, caseIds: string[], factor: number, copyLabel: string): BatchChange & { differences: LoadScaleDifference[] } {
  if (!Number.isFinite(factor)) throw new Error('bulk.invalidFactor');
  const selected = new Set(caseIds);
  if (!selected.size || [...selected].some((id) => !ir.analysis_cases.some((item) => item.id === id))) throw new Error('bulk.selectCases');
  const participants = new Map(ir.analysis_cases.map((item) => [item.id, resolvedIds(ir, item, 'participating_load_ids')]));
  const selectedLoadIds = new Set([...selected].flatMap((id) => participants.get(id) ?? []));
  const otherLoadIds = new Set(ir.analysis_cases.filter((item) => !selected.has(item.id)).flatMap((item) => participants.get(item.id) ?? []));
  const loads = structuredClone(ir.loads);
  const analysisCases = structuredClone(ir.analysis_cases);
  const replacements = new Map<string, string>();
  const differences: LoadScaleDifference[] = [];
  for (const id of selectedLoadIds) {
    const original = ir.loads.find((item) => item.id === id);
    if (!original) continue; // Keep broken explicit references for validation to report.
    const after = original.magnitude * factor;
    if (!Number.isFinite(after)) throw new Error('bulk.invalidFactor');
    if (Object.is(after, original.magnitude)) continue;
    const copied = otherLoadIds.has(id);
    if (copied) {
      const copy = { ...structuredClone(original), id: generateId('load'), name: uniqueEntityName(`${original.name} ${copyLabel}`, loads), magnitude: after };
      loads.push(copy);
      replacements.set(id, copy.id);
    } else loads.find((item) => item.id === id)!.magnitude = after;
    for (const caseId of selected) {
      if (participants.get(caseId)?.includes(id)) differences.push({ caseId, loadId: id, before: original.magnitude, after, copied });
    }
  }
  if (replacements.size) {
    freezeAll(ir, analysisCases, 'participating_load_ids');
    for (const analysisCase of analysisCases.filter((item) => selected.has(item.id))) {
      Object.assign(analysisCase, participationUpdate(analysisCase, 'participating_load_ids',
        (participants.get(analysisCase.id) ?? []).map((id) => replacements.get(id) ?? id)));
    }
  }
  return { patch: { loads, analysis_cases: analysisCases }, differences };
}
