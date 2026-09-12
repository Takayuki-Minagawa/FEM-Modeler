import type {
  BoundaryCondition
} from '@/core/ir/types';


export function convectionCoefficient(bc: BoundaryCondition): number | undefined {
  return bc.values.heat_transfer_coefficient ?? bc.values.scalar;
}

export function convectionAmbientTemperature(bc: BoundaryCondition): number | undefined {
  return bc.values.ambient_temperature ?? bc.values.vector?.[0];
}

export function structuralDofValues(bc: BoundaryCondition): { component: number; value: number }[] {
  if (bc.bc_type !== 'fixed' && bc.bc_type !== 'prescribed_displacement') return [];
  const keys = ['ux', 'uy', 'uz'] as const;
  const dofMap = bc.values.dof_map;
  if (bc.bc_type === 'prescribed_displacement' && !bc.values.vector && !dofMap) return [];
  const scalar = bc.values.scalar ?? 0;
  const vector = bc.values.vector ?? [scalar, scalar, scalar];
  const values: { component: number; value: number }[] = [];

  for (let component = 0;component < keys.length;component++) {
    const state = dofMap?.[keys[component]];
    const constrained = dofMap ? state !== 'free' : true;
    if (!constrained) continue;
    const value = bc.bc_type === 'prescribed_displacement' && state !== 'fixed'
      ? vector[component]
      : 0;
    values.push({ component, value });
  }
  return values;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isPositiveFinite(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

export function isUnresolvedStatus(status: string): boolean {
  return status === 'missing' || status === 'needs_review';
}

export function number(value: number): string {
  if (Object.is(value, -0)) return '0';
  return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(15)));
}

export function safeComment(value: string): string {
  return Array.from(value, (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029
      ? ' '
      : character;
  }).join('').replace(/\*\//g, '* /');
}
