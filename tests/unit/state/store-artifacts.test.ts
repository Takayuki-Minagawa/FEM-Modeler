import { beforeEach, describe, expect, it } from 'vitest';
import type { ResultIR } from '@/core/ir/types';
import { useAppStore } from '@/state/store';

function result(id: string, revision: number): ResultIR {
  return {
    id,
    analysis_case_id: 'case',
    solver_target: 'OpenSeesPy',
    source_file_name: 'result_manifest.json',
    imported_at: new Date(0).toISOString(),
    status: 'partial',
    fields: [],
    checks: [],
    metadata: { imported_for_model_revision: revision },
  };
}

describe('store assignment and result invariants', () => {
  beforeEach(() => useAppStore.getState().createProject('artifact test', 'frame'));

  it('replaces material and section assignments for the same target selection', () => {
    const store = useAppStore.getState();
    store.addMaterialAssignment({ id: 'ma1', material_id: 'm1', target_named_selection_id: 'selection', override_allowed: false });
    store.addMaterialAssignment({ id: 'ma2', material_id: 'm2', target_named_selection_id: 'selection', override_allowed: true });
    store.addSectionAssignment({ id: 'sa1', section_id: 's1', target_named_selection_id: 'selection' });
    store.addSectionAssignment({ id: 'sa2', section_id: 's2', target_named_selection_id: 'selection' });

    expect(useAppStore.getState().ir.material_assignments).toEqual([
      expect.objectContaining({ id: 'ma2', material_id: 'm2' }),
    ]);
    expect(useAppStore.getState().ir.section_assignments).toEqual([
      expect.objectContaining({ id: 'sa2', section_id: 's2' }),
    ]);
  });

  it('does not invalidate the solver-input revision when results are added or removed', () => {
    const store = useAppStore.getState();
    const revision = store.ir.validation.model_revision;
    store.addResult(result('result', revision));
    expect(useAppStore.getState().ir.validation.model_revision).toBe(revision);

    useAppStore.getState().removeResult('result');
    expect(useAppStore.getState().ir.validation.model_revision).toBe(revision);
  });
});
