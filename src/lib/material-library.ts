import type { Material, MaterialParameterKey, TrackedValue } from '@/core/ir/types';
import { generateId } from '@/core/ir/id-generator';
import { createTrackedValue } from '@/core/ir/defaults';

function lib(v: number): TrackedValue<number | null> {
  return createTrackedValue(v, 'library');
}
function empty(): TrackedValue<number | null> {
  return createTrackedValue(null, 'missing');
}

type ParamSet = Record<MaterialParameterKey, TrackedValue<number | null>>;

interface LibraryEntry {
  nameJa: string;
  nameEn: string;
  material: Omit<Material, 'id' | 'name'>;
}

export const MATERIAL_LIBRARY: LibraryEntry[] = [
  {
    nameJa: '鋼材 (SS400)',
    nameEn: 'Steel (SS400)',
    material: {
      class: 'elastic',
      physical_model: 'isotropic_linear',
      parameter_set: {
        density: lib(7850),
        young_modulus: lib(2.05e11),
        poisson_ratio: lib(0.3),
        thermal_conductivity: lib(50.2),
        specific_heat: lib(486),
        dynamic_viscosity: empty(),
        kinematic_viscosity: empty(),
      } as ParamSet,
      source: 'JIS G 3101',
      notes: '',
    },
  },
  {
    nameJa: 'アルミ合金 (A6061-T6)',
    nameEn: 'Aluminum (A6061-T6)',
    material: {
      class: 'elastic',
      physical_model: 'isotropic_linear',
      parameter_set: {
        density: lib(2700),
        young_modulus: lib(6.89e10),
        poisson_ratio: lib(0.33),
        thermal_conductivity: lib(167),
        specific_heat: lib(896),
        dynamic_viscosity: empty(),
        kinematic_viscosity: empty(),
      } as ParamSet,
      source: 'ASM',
      notes: '',
    },
  },
  {
    nameJa: 'コンクリート (Fc=24)',
    nameEn: 'Concrete (Fc=24)',
    material: {
      class: 'elastic',
      physical_model: 'isotropic_linear',
      parameter_set: {
        density: lib(2400),
        young_modulus: lib(2.5e10),
        poisson_ratio: lib(0.2),
        thermal_conductivity: lib(1.6),
        specific_heat: lib(880),
        dynamic_viscosity: empty(),
        kinematic_viscosity: empty(),
      } as ParamSet,
      source: 'AIJ',
      notes: '',
    },
  },
  {
    nameJa: '水 (20°C)',
    nameEn: 'Water (20°C)',
    material: {
      class: 'fluid_newtonian',
      physical_model: 'incompressible_newtonian',
      parameter_set: {
        density: lib(998.2),
        young_modulus: empty(),
        poisson_ratio: empty(),
        thermal_conductivity: lib(0.598),
        specific_heat: lib(4182),
        dynamic_viscosity: lib(1.002e-3),
        kinematic_viscosity: lib(1.004e-6),
      } as ParamSet,
      source: 'CRC Handbook',
      notes: '',
    },
  },
  {
    nameJa: '空気 (20°C)',
    nameEn: 'Air (20°C)',
    material: {
      class: 'fluid_newtonian',
      physical_model: 'incompressible_newtonian',
      parameter_set: {
        density: lib(1.204),
        young_modulus: empty(),
        poisson_ratio: empty(),
        thermal_conductivity: lib(0.0257),
        specific_heat: lib(1005),
        dynamic_viscosity: lib(1.825e-5),
        kinematic_viscosity: lib(1.516e-5),
      } as ParamSet,
      source: 'Engineering Toolbox',
      notes: '',
    },
  },
];

export function createMaterialFromLibrary(entry: LibraryEntry, lang: string): Material {
  return {
    id: generateId('material'),
    name: lang === 'ja' ? entry.nameJa : entry.nameEn,
    ...entry.material,
  };
}
