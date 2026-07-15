import { describe, expect, it } from 'vitest';
import { calculateSectionProperties } from '@/core/sections/properties';
import { createDefaultProject } from '@/core/ir/defaults';
import { validateCommon } from '@/validation/rules/common';

describe('section property calculator', () => {
  it('calculates circular area, inertia, and polar torsion', () => {
    const result = calculateSectionProperties({ section_type: 'beam_circle', dimensions: { diameter: 0.2 } });

    expect(result?.area).toBeCloseTo(Math.PI * 0.01);
    expect(result?.inertiaY).toBeCloseTo(Math.PI * 0.2 ** 4 / 64);
    expect(result?.inertiaZ).toBe(result?.inertiaY);
    expect(result?.torsionConstant).toBeCloseTo(Math.PI * 0.2 ** 4 / 32);
  });

  it('calculates rectangular strong/weak inertias in a documented axis convention', () => {
    const result = calculateSectionProperties({ section_type: 'beam_rect', dimensions: { width: 0.2, height: 0.4 } });

    expect(result?.area).toBeCloseTo(0.08);
    expect(result?.inertiaY).toBeCloseTo(0.4 * 0.2 ** 3 / 12);
    expect(result?.inertiaZ).toBeCloseTo(0.2 * 0.4 ** 3 / 12);
  });

  it('calculates a symmetric H-section and rejects impossible dimensions', () => {
    const result = calculateSectionProperties({
      section_type: 'beam_h',
      dimensions: { width: 0.2, height: 0.4, flange_thickness: 0.02, web_thickness: 0.012 },
    });
    const invalid = calculateSectionProperties({
      section_type: 'beam_h',
      dimensions: { width: 0.2, height: 0.04, flange_thickness: 0.02, web_thickness: 0.012 },
    });

    expect(result?.area).toBeCloseTo(2 * 0.2 * 0.02 + 0.36 * 0.012);
    expect(result?.inertiaZ).toBeGreaterThan(result?.inertiaY ?? Infinity);
    expect(invalid).toBeNull();
  });

  it('reports an explicit property that disagrees with calculable dimensions', () => {
    const ir = createDefaultProject();
    ir.sections.push({
      id: 'rect',
      name: 'Rectangular',
      section_type: 'beam_rect',
      dimensions: { width: 0.2, height: 0.4 },
      material_id: '',
      area: 1,
      inertia_y: null,
      inertia_z: null,
      torsion_constant: null,
      thickness: null,
      metadata: {},
    });

    expect(validateCommon(ir)).toContainEqual(expect.objectContaining({
      code: 'SECTION_PROPERTY_MISMATCH_AREA',
      severity: 'warning',
    }));
  });

  it('reports impossible H-section flange and web proportions', () => {
    const ir = createDefaultProject();
    ir.sections.push({
      id: 'bad_h',
      name: 'Bad H',
      section_type: 'beam_h',
      dimensions: { width: 0.2, height: 0.1, flange_thickness: 0.05, web_thickness: 0.3 },
      material_id: '',
      area: null,
      inertia_y: null,
      inertia_z: null,
      torsion_constant: null,
      thickness: null,
      metadata: { property_source: 'needs_review' },
    });

    const codes = validateCommon(ir).map((item) => item.code);
    expect(codes).toContain('SECTION_H_FLANGE_GEOMETRY');
    expect(codes).toContain('SECTION_H_WEB_GEOMETRY');
    expect(codes).toContain('SECTION_DIMENSIONS_UNRESOLVED');
  });

  it('rejects incompatible material class and physical-model pairs', () => {
    const ir = createDefaultProject();
    ir.materials.push({
      id: 'bad_fluid', name: 'Bad fluid', class: 'fluid_newtonian', physical_model: 'isotropic_linear',
      parameter_set: {
        density: { value: 1000, status: 'confirmed' },
        young_modulus: { value: null, status: 'missing' },
        poisson_ratio: { value: null, status: 'missing' },
        thermal_conductivity: { value: null, status: 'missing' },
        specific_heat: { value: null, status: 'missing' },
        dynamic_viscosity: { value: 0.001, status: 'confirmed' },
        kinematic_viscosity: { value: 0.000001, status: 'confirmed' },
      },
      source: '', notes: '',
    });

    expect(validateCommon(ir)).toContainEqual(expect.objectContaining({
      code: 'MAT_CLASS_MODEL_MISMATCH', severity: 'error', target_ref: 'bad_fluid',
    }));
  });
});
