import type { ProjectIR, SolverTargetName } from '@/core/ir/types';
import { getParticipationMode } from '@/core/ir/participation';
import { preflightExport, scopeProjectForAnalysisCaseValidation, type ExportPreflight } from '@/export/compiler';
import { isValidationCurrent } from './context';
import { diagnosticTarget } from './navigation';
import { SOLVER_SHAPES } from './solver-support';

export type GuideStatus = 'complete' | 'required' | 'optional' | 'unsupported';
export interface GuideStep { panel: string; status: GuideStatus; reason?: string }

/** This is a preparation guide; successful package generation remains the final compiler check. */
export function analysisWorkflowGuide(ir: ProjectIR, target: SolverTargetName, caseId: string, preflight: ExportPreflight = preflightExport(ir, target, caseId)) {
  const analysisCase = preflight.analysisCase;
  const scope = analysisCase ? scopeProjectForAnalysisCaseValidation(ir, analysisCase.id) : undefined;
  const current = isValidationCurrent(ir, target, caseId);
  const issues = [...preflight.errors];
  if (current) {
    for (const item of ir.validation.items.filter(item => item.severity === 'error')) {
      if (!issues.some(issue => issue.code === item.code && issue.targetRef === item.target_ref)) {
        issues.push({ code: item.code, message: item.message, targetRef: item.target_ref });
      }
    }
  }
  for (const body of scope?.geometry.bodies ?? []) {
    if (!SOLVER_SHAPES[target].includes(String(body.metadata.shapeType)) || (target === 'DOLFINx' && body.category !== 'solid')) {
      issues.push({ code: 'GUIDE_SHAPE_UNSUPPORTED', message: `${body.name}: ${String(body.metadata.shapeType ?? body.category)}`, targetRef: body.id });
    }
  }
  const step = (panel: string, complete: boolean, reason?: string, optional = false): GuideStep => ({
    panel, status: complete ? 'complete' : optional ? 'optional' : 'required', reason,
  });
  const bc = scope?.boundary_conditions ?? [];
  const thermal = analysisCase?.domain_type === 'thermal';
  const hasBoundary = target === 'OpenFOAM'
    ? bc.filter(item => item.bc_type === 'velocity_inlet').length === 1
      && bc.filter(item => item.bc_type === 'pressure_outlet').length === 1
      && bc.filter(item => item.bc_type === 'wall' || item.bc_type === 'no_slip').length === 2
    : bc.some(item => thermal ? item.bc_type === 'temperature'
      || (item.bc_type === 'convection' && Number(item.values.heat_transfer_coefficient ?? item.values.scalar) > 0)
      : item.bc_type === 'fixed' || item.bc_type === 'prescribed_displacement');
  const noLoads = !scope?.loads.length;
  const noLoadIntent = analysisCase && getParticipationMode(analysisCase, 'participating_load_ids') === 'none';
  const noBoundaryIntent = analysisCase && getParticipationMode(analysisCase, 'participating_bc_ids') === 'none';
  const frame = target === 'OpenSeesPy';
  const selections = scope?.named_selections ?? [];
  const steps = [
    step('analysis', Boolean(analysisCase), 'analysis'),
    step('geometry', (scope?.geometry.bodies.length ?? 0) > 0, 'geometry'),
    step('materials', (scope?.material_assignments.length ?? 0) > 0
      || (frame && Boolean(scope?.sections.some(section => scope.materials.some(material => material.id === section.material_id)))), 'materials'),
    step('sections', frame && (scope?.section_assignments.length ?? 0) > 0, frame ? 'sections' : 'noSections', !frame),
    step('selections', selections.length > 0 && selections.every(item => item.status === 'active' && item.member_refs.length > 0), 'selections'),
    step('bc', hasBoundary, noBoundaryIntent ? 'boundaryExcluded' : target === 'OpenFOAM' ? 'fluidBoundary' : thermal ? 'thermalBoundary' : 'structuralBoundary'),
    step('loads', !noLoads, noLoadIntent ? 'loadsExcluded' : 'zeroLoads', true),
    step('mesh', !frame && Number(ir.mesh_controls.global.global_size) > 0,
      frame ? 'memberGraph' : 'mesh', frame),
    step('validation', current && ir.validation.summary.error_count === 0 && issues.length === 0, current ? 'validationErrors' : 'validation'),
  ];
  const issueTargets = issues.map(issue => ({ issue, target: diagnosticTarget(ir, issue.targetRef, issue.code)
    ?? { panel: issue.targetRef === 'geometry' ? 'geometry' : issue.code.startsWith('MATERIAL') ? 'materials' : 'analysis', name: issue.targetRef } }));
  for (const { target: issueTarget } of issueTargets) {
    const row = steps.find(item => item.panel === issueTarget.panel);
    if (row) row.status = 'unsupported';
  }
  const next = steps.find(item => item.status === 'required' || item.status === 'unsupported');
  return { steps, next, issues: issueTargets };
}
