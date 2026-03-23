import type { UnitSystem, UnitSystemName } from '../ir/types';

export interface UnitPreset {
  name: UnitSystemName;
  label: string;
  system: UnitSystem;
}
