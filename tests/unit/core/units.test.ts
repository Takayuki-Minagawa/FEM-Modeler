import { describe, expect, it } from 'vitest';
import { fromSI, quantityUnitLabel, toSI } from '@/core/units';

describe('canonical unit conversions', () => {
  it.each([
    ['length', 1250, 1.25],
    ['area', 2_000_000, 2],
    ['fourth_moment', 1e12, 1],
    ['stress', 205_000, 205e9],
    ['line_load', 2, 2_000],
    ['surface_load', 2, 2e6],
  ] as const)('round-trips %s between mm-N-s and SI', (kind, displayValue, siValue) => {
    expect(toSI(displayValue, kind, 'mm-N-s')).toBeCloseTo(siValue);
    expect(fromSI(siValue, kind, 'mm-N-s')).toBeCloseTo(displayValue);
  });

  it('distinguishes kg/mm3 and t/mm3 density presets', () => {
    expect(toSI(7.85e-6, 'density', 'mm-N-s')).toBeCloseTo(7850);
    expect(toSI(7.85e-9, 'density', 'mm-t-s')).toBeCloseTo(7850);
    expect(quantityUnitLabel('density', 'mm-N-s')).toBe('kg/mm³');
    expect(quantityUnitLabel('density', 'mm-t-s')).toBe('t/mm³');
  });
});
