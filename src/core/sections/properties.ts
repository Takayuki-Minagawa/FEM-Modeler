import type { Section, SectionType } from '@/core/ir/types';

export interface CalculatedSectionProperties {
  area: number;
  inertiaY: number;
  inertiaZ: number;
  torsionConstant: number;
  source: 'dimensions';
}

function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** Calculate SI section properties only when all required dimensions are explicit and valid. */
export function calculateSectionProperties(
  section: Pick<Section, 'section_type' | 'dimensions'>,
): CalculatedSectionProperties | null {
  const dimensions = section.dimensions;
  if (section.section_type === 'beam_circle') {
    const diameter = positive(dimensions.diameter);
    if (!diameter) return null;
    return {
      area: Math.PI * diameter ** 2 / 4,
      inertiaY: Math.PI * diameter ** 4 / 64,
      inertiaZ: Math.PI * diameter ** 4 / 64,
      torsionConstant: Math.PI * diameter ** 4 / 32,
      source: 'dimensions',
    };
  }

  if (section.section_type === 'beam_rect') {
    const width = positive(dimensions.width);
    const height = positive(dimensions.height);
    if (!width || !height) return null;
    return {
      area: width * height,
      inertiaY: height * width ** 3 / 12,
      inertiaZ: width * height ** 3 / 12,
      // Saint-Venant approximation; exact enough for a transparent preprocessor estimate.
      torsionConstant: rectangularTorsion(width, height),
      source: 'dimensions',
    };
  }

  if (section.section_type === 'beam_h') {
    const width = positive(dimensions.width);
    const height = positive(dimensions.height);
    const flange = positive(dimensions.flange_thickness);
    const web = positive(dimensions.web_thickness);
    if (!width || !height || !flange || !web || 2 * flange >= height || web > width) return null;
    const webHeight = height - 2 * flange;
    return {
      area: 2 * width * flange + webHeight * web,
      inertiaY: (2 * flange * width ** 3 + webHeight * web ** 3) / 12,
      inertiaZ: (width * height ** 3 - (width - web) * webHeight ** 3) / 12,
      torsionConstant: (2 * width * flange ** 3 + webHeight * web ** 3) / 3,
      source: 'dimensions',
    };
  }

  return null;
}

export function defaultSectionDimensions(type: SectionType): Record<string, number> {
  switch (type) {
    case 'beam_rect': return { width: 0.3, height: 0.5 };
    case 'beam_circle': return { diameter: 0.1 };
    case 'beam_h': return { width: 0.2, height: 0.4, flange_thickness: 0.02, web_thickness: 0.012 };
    default: return {};
  }
}

function rectangularTorsion(width: number, height: number): number {
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  const ratio = short / long;
  return long * short ** 3 * (1 / 3 - 0.21 * ratio * (1 - ratio ** 4 / 12));
}
