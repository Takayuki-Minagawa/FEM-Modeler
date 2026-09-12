import { inputFingerprint } from '@/core/ir/provenance';
import type { ProjectIR, SolverTargetName, ValidationState } from '@/core/ir/types';

export function validationContextFor(ir: ProjectIR, target: SolverTargetName, caseId?: string): ValidationState['context'] {
  const id = caseId ?? ir.analysis_cases.find((item) => item.active)?.id;
  if (!id) return undefined;
  try {
    return { analysis_case_id: id, solver_target: target, input_fingerprint: inputFingerprint(ir, target, id) };
  } catch {
    return undefined;
  }
}

export function isValidationCurrent(ir: ProjectIR, target: SolverTargetName, caseId?: string): boolean {
  const previous = ir.validation.context;
  const current = validationContextFor(ir, target, caseId);
  return Boolean(previous && current && ir.validation.last_run_at
    && ir.validation.validated_revision === ir.validation.model_revision
    && previous.analysis_case_id === current.analysis_case_id
    && previous.solver_target === current.solver_target
    && previous.input_fingerprint === current.input_fingerprint);
}
