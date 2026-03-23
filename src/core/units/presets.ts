import type { UnitSystem } from '../ir/types';
import type { UnitPreset } from './types';

const SI: UnitSystem = {
  system_name: 'SI',
  base_length: 'm',
  base_mass: 'kg',
  base_time: 's',
  base_temperature: 'K',
  base_force: 'N',
  angle_unit: 'rad',
  display_precision: 6,
  preferred_stress_unit: 'Pa',
  preferred_pressure_unit: 'Pa',
  preferred_energy_unit: 'J',
};

const MM_N_S: UnitSystem = {
  system_name: 'mm-N-s',
  base_length: 'mm',
  base_mass: 'kg',
  base_time: 's',
  base_temperature: 'K',
  base_force: 'N',
  angle_unit: 'rad',
  display_precision: 4,
  preferred_stress_unit: 'MPa',
  preferred_pressure_unit: 'MPa',
  preferred_energy_unit: 'mJ',
};

const MM_T_S: UnitSystem = {
  system_name: 'mm-t-s',
  base_length: 'mm',
  base_mass: 't',
  base_time: 's',
  base_temperature: 'K',
  base_force: 'N',
  angle_unit: 'rad',
  display_precision: 4,
  preferred_stress_unit: 'MPa',
  preferred_pressure_unit: 'MPa',
  preferred_energy_unit: 'mJ',
};

export const UNIT_PRESETS: UnitPreset[] = [
  { name: 'SI', label: 'SI (m, kg, N, Pa)', system: SI },
  { name: 'mm-N-s', label: 'mm-N-s (mm, kg, N, MPa)', system: MM_N_S },
  { name: 'mm-t-s', label: 'mm-t-s (mm, t, N, MPa)', system: MM_T_S },
];

export function getUnitPreset(name: string): UnitSystem {
  const preset = UNIT_PRESETS.find((p) => p.name === name);
  return preset ? { ...preset.system } : { ...SI };
}
