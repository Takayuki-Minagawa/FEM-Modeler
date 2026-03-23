import type { ProjectIR, ValidationState } from '@/core/ir/types';
import { validateCommon } from './rules/common';
import { validateOpenSeesPy } from './rules/openseespy';
import { validateDOLFINx } from './rules/dolfinx';
import { validateOpenFOAM } from './rules/openfoam';

export function runValidation(ir: ProjectIR): ValidationState {
  const items = [
    ...validateCommon(ir),
    ...validateOpenSeesPy(ir),
    ...validateDOLFINx(ir),
    ...validateOpenFOAM(ir),
  ];

  const errorCount = items.filter((i) => i.severity === 'error').length;
  const warningCount = items.filter((i) => i.severity === 'warning').length;
  const infoCount = items.filter((i) => i.severity === 'info').length;

  return {
    last_run_at: new Date().toISOString(),
    summary: {
      error_count: errorCount,
      warning_count: warningCount,
      info_count: infoCount,
    },
    items,
  };
}
