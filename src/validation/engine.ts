import type { ProjectIR, SolverTargetName, ValidationState } from '@/core/ir/types';
import { preflightExport, scopeProjectForAnalysisCaseValidation } from '@/export/compiler';
import { createItem } from './types';
import { validateCommon } from './rules/common';
import { validateOpenSeesPy } from './rules/openseespy';
import { validateDOLFINx } from './rules/dolfinx';
import { validateOpenFOAM } from './rules/openfoam';

export function runValidation(ir: ProjectIR, requestedTarget?: SolverTargetName, analysisCaseId?: string): ValidationState {
  let validationIr = ir;
  if (requestedTarget && analysisCaseId) {
    try {
      validationIr = scopeProjectForAnalysisCaseValidation(ir, analysisCaseId);
    } catch {
      // preflightExport below emits the stable missing-case diagnostic.
    }
  }
  const targetItems = requestedTarget
    ? requestedTarget === 'OpenSeesPy'
      ? validateOpenSeesPy(validationIr, true)
      : requestedTarget === 'DOLFINx'
        ? validateDOLFINx(validationIr, true)
        : validateOpenFOAM(validationIr, true)
    : [
        ...validateOpenSeesPy(ir),
        ...validateDOLFINx(ir),
        ...validateOpenFOAM(ir),
      ];
  const items = [
    ...validateCommon(validationIr),
    ...targetItems,
  ];

  if (requestedTarget) {
    const preflight = preflightExport(ir, requestedTarget, analysisCaseId);
    items.push(
      ...preflight.errors.map((issue) => createItem('error', issue.code, 'Unsupported export request', issue.message, issue.targetRef, 'Choose a supported analysis case or remove the unsupported item.', false)),
      ...preflight.warnings.map((issue) => createItem('warning', issue.code, 'Export coverage notice', issue.message, issue.targetRef, 'Review the selected analysis case participation lists.')),
    );
  }

  const errorCount = items.filter((i) => i.severity === 'error').length;
  const warningCount = items.filter((i) => i.severity === 'warning').length;
  const infoCount = items.filter((i) => i.severity === 'info').length;

  return {
    last_run_at: new Date().toISOString(),
    model_revision: ir.validation.model_revision,
    validated_revision: ir.validation.model_revision,
    summary: {
      error_count: errorCount,
      warning_count: warningCount,
      info_count: infoCount,
    },
    items,
  };
}
