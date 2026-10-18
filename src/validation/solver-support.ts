import type { AnalysisCase, PhysicsDomain, SolverTargetName } from '@/core/ir/types';
import { SOLVER_CAPABILITIES } from '@/export/compiler';

export type SolverInputKind = 'shape' | 'bc' | 'load';
/** Native topology accepted by the current strict exporters. */
export const SOLVER_SHAPES: Record<SolverTargetName, readonly string[]> = {
  OpenSeesPy: ['frame2d', 'truss2d'],
  DOLFINx: ['box', 'plate', 'plateWithHole', 'cylinder'],
  OpenFOAM: ['channel'],
};

export function solverForCase(analysisCase?: AnalysisCase): SolverTargetName | undefined {
  return (Object.keys(SOLVER_CAPABILITIES) as SolverTargetName[])
    .find(target => analysisCase && SOLVER_CAPABILITIES[target].solverProfiles.includes(analysisCase.solver_profile_hint));
}

export function supportedSolvers(kind: SolverInputKind, value: string, domain?: PhysicsDomain): SolverTargetName[] {
  return (Object.keys(SOLVER_CAPABILITIES) as SolverTargetName[]).filter(target => {
    const capability = SOLVER_CAPABILITIES[target];
    const values: readonly string[] = kind === 'shape' ? SOLVER_SHAPES[target]
      : kind === 'bc' ? capability.boundaryConditions : capability.loads;
    if (!values.includes(value)) return false;
    if (!domain || kind === 'shape') return true;
    if (target === 'OpenSeesPy') return domain === 'structural';
    if (target === 'OpenFOAM') return domain === 'fluid';
    const thermal = ['temperature', 'heat_flux', 'convection', 'insulation', 'heat_source', 'volumetric_heat'].includes(value);
    return domain === (thermal ? 'thermal' : 'structural');
  });
}
