import { describe, expect, it } from 'vitest';
import { useAppStore } from '@/state/store';
import { applyTemplate } from '@/lib/project-templates';
import { runValidation } from '@/validation/engine';
import { isValidationCurrent } from '@/validation/context';

describe('case-specific validation state', () => {
  it('cannot reuse a validation result for another case, target or input', () => {
    useAppStore.getState().createProject('case context', 'frame'); applyTemplate('frame', 'en');
    const ir = structuredClone(useAppStore.getState().ir);
    const id = ir.analysis_cases[0].id;
    ir.analysis_cases.push({ ...ir.analysis_cases[0], id: 'second-case', active: false });
    ir.validation = runValidation(ir, 'OpenSeesPy', id);
    expect(isValidationCurrent(ir, 'OpenSeesPy', id)).toBe(true);
    expect(isValidationCurrent(ir, 'OpenSeesPy', 'second-case')).toBe(false);
    expect(isValidationCurrent(ir, 'DOLFINx', id)).toBe(false);
    ir.loads[0].magnitude += 100;
    expect(isValidationCurrent(ir, 'OpenSeesPy', id)).toBe(false);
  });

  it('keeps global validation and missing-case states separate from solver validation', () => {
    useAppStore.getState().createProject('case context', 'frame'); applyTemplate('frame', 'en');
    const ir = structuredClone(useAppStore.getState().ir);
    ir.validation = runValidation(ir);
    expect(isValidationCurrent(ir, 'OpenSeesPy', ir.analysis_cases[0].id)).toBe(false);
    expect(isValidationCurrent(ir, 'OpenSeesPy', 'missing')).toBe(false);
  });
});
