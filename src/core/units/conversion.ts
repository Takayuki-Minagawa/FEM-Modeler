import type { UnitSystemName } from '@/core/ir/types';

/**
 * ProjectIR stores every numeric quantity in canonical SI units.  A selected
 * unit system is a presentation preference only; these helpers are the single
 * conversion boundary used by forms and reports.
 */
export type QuantityKind =
  | 'length'
  | 'area'
  | 'fourth_moment'
  | 'stress'
  | 'pressure'
  | 'kinematic_pressure'
  | 'density'
  | 'force'
  | 'acceleration'
  | 'velocity'
  | 'line_load'
  | 'surface_load'
  | 'volume_load'
  | 'temperature'
  | 'thermal_conductivity'
  | 'specific_heat'
  | 'dynamic_viscosity'
  | 'kinematic_viscosity'
  | 'power'
  | 'heat_flux'
  | 'volumetric_heat'
  | 'convection_coefficient'
  | 'mass_flow_rate'
  | 'dimensionless';

const MM_N_S_FACTORS_TO_SI: Record<QuantityKind, number> = {
  length: 1e-3,
  area: 1e-6,
  fourth_moment: 1e-12,
  stress: 1e6,
  pressure: 1e6,
  kinematic_pressure: 1e-6,
  density: 1e9, // kg/mm^3 -> kg/m^3
  force: 1,
  acceleration: 1e-3,
  velocity: 1e-3,
  line_load: 1e3,
  surface_load: 1e6,
  volume_load: 1e9,
  temperature: 1,
  thermal_conductivity: 1,
  specific_heat: 1,
  dynamic_viscosity: 1,
  kinematic_viscosity: 1,
  power: 1,
  heat_flux: 1e6,
  volumetric_heat: 1e9,
  convection_coefficient: 1e6,
  mass_flow_rate: 1,
  dimensionless: 1,
};

const MM_T_S_FACTORS_TO_SI: Record<QuantityKind, number> = {
  ...MM_N_S_FACTORS_TO_SI,
  density: 1e12, // t/mm^3 -> kg/m^3
};

const SI_LABELS: Record<QuantityKind, string> = {
  length: 'm',
  area: 'm²',
  fourth_moment: 'm⁴',
  stress: 'Pa',
  pressure: 'Pa',
  kinematic_pressure: 'm²/s²',
  density: 'kg/m³',
  force: 'N',
  acceleration: 'm/s²',
  velocity: 'm/s',
  line_load: 'N/m',
  surface_load: 'N/m²',
  volume_load: 'N/m³',
  temperature: 'K',
  thermal_conductivity: 'W/(m·K)',
  specific_heat: 'J/(kg·K)',
  dynamic_viscosity: 'Pa·s',
  kinematic_viscosity: 'm²/s',
  power: 'W',
  heat_flux: 'W/m²',
  volumetric_heat: 'W/m³',
  convection_coefficient: 'W/(m²·K)',
  mass_flow_rate: 'kg/s',
  dimensionless: '—',
};

const MM_N_S_LABELS: Record<QuantityKind, string> = {
  ...SI_LABELS,
  length: 'mm',
  area: 'mm²',
  fourth_moment: 'mm⁴',
  stress: 'MPa',
  pressure: 'MPa',
  kinematic_pressure: 'mm²/s²',
  density: 'kg/mm³',
  acceleration: 'mm/s²',
  velocity: 'mm/s',
  line_load: 'N/mm',
  surface_load: 'N/mm²',
  volume_load: 'N/mm³',
  heat_flux: 'W/mm²',
  volumetric_heat: 'W/mm³',
  convection_coefficient: 'W/(mm²·K)',
};

const MM_T_S_LABELS: Record<QuantityKind, string> = {
  ...MM_N_S_LABELS,
  density: 't/mm³',
};

export function isSIUnitSystem(system: UnitSystemName): boolean {
  return system === 'SI' || system === 'custom';
}

export function quantityFactorToSI(kind: QuantityKind, system: UnitSystemName): number {
  if (isSIUnitSystem(system)) return 1;
  return (system === 'mm-t-s' ? MM_T_S_FACTORS_TO_SI : MM_N_S_FACTORS_TO_SI)[kind];
}

export function toSI(value: number, kind: QuantityKind, system: UnitSystemName): number {
  return value * quantityFactorToSI(kind, system);
}

export function fromSI(value: number, kind: QuantityKind, system: UnitSystemName): number {
  return value / quantityFactorToSI(kind, system);
}

export function convertNullableFromSI(
  value: number | null,
  kind: QuantityKind,
  system: UnitSystemName,
): number | null {
  return value === null ? null : fromSI(value, kind, system);
}

export function convertNullableToSI(
  value: number | null,
  kind: QuantityKind,
  system: UnitSystemName,
): number | null {
  return value === null ? null : toSI(value, kind, system);
}

/** Concise aliases used by controlled form components. */
export const fromSINullable = convertNullableFromSI;
export const toSINullable = convertNullableToSI;

export function quantityUnitLabel(kind: QuantityKind, system: UnitSystemName): string {
  if (isSIUnitSystem(system)) return SI_LABELS[kind];
  return (system === 'mm-t-s' ? MM_T_S_LABELS : MM_N_S_LABELS)[kind];
}
