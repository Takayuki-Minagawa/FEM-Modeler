import { beforeEach, describe, expect, it } from 'vitest';
import { planAssignments, planDuplicate, planLoadScaling } from '@/core/ir/batch';
import { participationUpdate } from '@/core/ir/participation';
import type { ProjectIR } from '@/core/ir/types';
import { useAppStore } from '@/state/store';
import { applyTemplate } from '@/lib/project-templates';
import { scopeProjectForAnalysisCaseValidation } from '@/export/compiler/capabilities';
import { parseProjectFile } from '@/export/project/load';

let ir: ProjectIR;
beforeEach(() => {
  useAppStore.getState().createProject('Batch', 'frame');
  applyTemplate('frame', 'en');
  ir = structuredClone(useAppStore.getState().ir);
});

describe('entity copies', () => {
  it.each(['material', 'section'] as const)('copies %s properties without replacing existing assignments', (kind) => {
    const collection = kind === 'material' ? 'materials' : 'sections';
    const original = ir[collection][0];
    const first = planDuplicate(ir, kind, original.id, '(copy)');
    const after = { ...ir, ...first.patch };
    const second = planDuplicate(after, kind, original.id, '(copy)');
    const saved = { ...after, ...second.patch };
    expect(new Set(saved[collection].map((item) => item.id)).size).toBe(saved[collection].length);
    expect(saved[collection].slice(-2).map((item) => item.name)).toEqual([`${original.name} (copy)`, `${original.name} (copy) 2`]);
    expect(saved.material_assignments).toEqual(ir.material_assignments);
    expect(saved.section_assignments).toEqual(ir.section_assignments);
    expect(parseProjectFile(JSON.stringify(saved)).success).toBe(true);
    if (kind === 'material') {
      saved.materials.at(-1)!.parameter_set.density.value = 12;
      expect(original).toEqual(ir.materials[0]);
      expect(ir.materials[0].parameter_set.density.value).not.toBe(12);
    }
  });

  it.each(['load', 'boundary_condition'] as const)('excludes a copied %s from all prior case scopes and roundtrips Undo/Redo once', (kind) => {
    const field = kind === 'load' ? 'participating_load_ids' : 'participating_bc_ids';
    const collection = kind === 'load' ? 'loads' : 'boundary_conditions';
    Object.assign(ir.analysis_cases[0], participationUpdate(ir.analysis_cases[0], field, [], 'all'));
    const unrelated = { ...structuredClone(ir.analysis_cases[0]), id: 'unrelated', active: false, domain_type: 'fluid' as const };
    ir.analysis_cases.push(unrelated);
    useAppStore.getState().loadProject(ir);
    const plan = planDuplicate(ir, kind, ir[collection][0].id, '(copy)');
    useAppStore.getState().mutateIR('copy', (draft) => Object.assign(draft, plan.patch));
    let changed = useAppStore.getState().ir;
    expect(changed[collection]).toHaveLength(ir[collection].length + 1);
    expect(scopeProjectForAnalysisCaseValidation(changed, unrelated.id)[collection]).toHaveLength(0);
    expect(scopeProjectForAnalysisCaseValidation(changed, ir.analysis_cases[0].id)[collection].map((item) => item.id)).toEqual(ir[collection].map((item) => item.id));
    useAppStore.getState().undo();
    expect(useAppStore.getState().ir).toEqual(ir);
    useAppStore.getState().redo();
    changed = useAppStore.getState().ir;
    expect(changed[collection].at(-1)!.id).toBe(plan.createdId);
  });

  it('copies active cases as inactive with exact current participants, including none and explicit missing references', () => {
    const source = ir.analysis_cases[0];
    Object.assign(source, participationUpdate(source, 'participating_bc_ids', [], 'none'));
    Object.assign(source, participationUpdate(source, 'participating_load_ids', [ir.loads[0].id, 'missing']));
    const plan = planDuplicate(ir, 'analysis_case', source.id, '(copy)');
    const copied = plan.patch.analysis_cases!.at(-1)!;
    expect(copied.active).toBe(false);
    expect(copied.participation_modes?.participating_bc_ids).toBe('none');
    expect(copied.participating_load_ids).toEqual([ir.loads[0].id, 'missing']);
    expect(copied.participating_material_ids).toEqual([ir.materials[0].id]);
    expect(source.active).toBe(true);
  });
});

describe('case load multipliers', () => {
  function shareLoad() {
    const source = ir.analysis_cases[0];
    Object.assign(source, participationUpdate(source, 'participating_load_ids', [], 'all'));
    ir.analysis_cases.push({ ...structuredClone(source), id: 'second', name: 'Second', active: false }, { ...structuredClone(source), id: 'third', name: 'Third', active: false });
  }

  it('copies a shared load once for selected cases, retaining the unselected case and SI values regardless of display units', () => {
    shareLoad();
    useAppStore.getState().setUnitSystem('mm-N-s');
    ir.units = useAppStore.getState().ir.units;
    const original = ir.loads[0];
    const plan = planLoadScaling(ir, [ir.analysis_cases[0].id, 'second'], 2.5, '(copy)');
    const changed = { ...ir, ...plan.patch };
    expect(changed.loads).toHaveLength(2);
    expect(changed.loads[0].magnitude).toBe(original.magnitude);
    expect(changed.loads[1].magnitude).toBe(original.magnitude * 2.5);
    expect(changed.loads[1].direction).toEqual(original.direction);
    expect(changed.analysis_cases[0].participating_load_ids).toEqual([changed.loads[1].id]);
    expect(changed.analysis_cases[1].participating_load_ids).toEqual([changed.loads[1].id]);
    expect(scopeProjectForAnalysisCaseValidation(changed, 'third').loads).toEqual([original]);
    expect(plan.differences).toHaveLength(2);
    expect(plan.differences.every((item) => item.copied)).toBe(true);
    expect(parseProjectFile(JSON.stringify(changed)).success).toBe(true);
  });

  it('scales a load shared only by selected cases exactly once and preserves none cases', () => {
    shareLoad();
    Object.assign(ir.analysis_cases[2], participationUpdate(ir.analysis_cases[2], 'participating_load_ids', []));
    const plan = planLoadScaling(ir, [ir.analysis_cases[0].id, 'second', 'second'], -2, '(copy)');
    expect(plan.patch.loads).toHaveLength(1);
    expect(plan.patch.loads![0].magnitude).toBe(ir.loads[0].magnitude * -2);
    expect(plan.patch.analysis_cases![2].participation_modes?.participating_load_ids).toBe('none');
    expect(plan.differences).toHaveLength(2);
    expect(plan.differences.every((item) => !item.copied)).toBe(true);
  });

  it('rejects nonfinite and overflowing products without touching the model, handles zero and no-op scales', () => {
    const before = structuredClone(ir);
    const ids = [ir.analysis_cases[0].id];
    expect(() => planLoadScaling(ir, ids, Infinity, '(copy)')).toThrow('bulk.invalidFactor');
    expect(() => planLoadScaling(ir, ids, Number.MAX_VALUE, '(copy)')).toThrow('bulk.invalidFactor');
    expect(planLoadScaling(ir, ids, 1, '(copy)').differences).toHaveLength(0);
    expect(planLoadScaling(ir, ids, 0, '(copy)').patch.loads![0].magnitude).toBe(0);
    expect(ir).toEqual(before);
  });
});

describe('multiple assignments', () => {
  it('previews replacement as a pure plan, then changes two targets and undoes atomically', () => {
    const first = ir.named_selections.find((item) => item.id === ir.material_assignments[0].target_named_selection_id)!;
    const second = { ...structuredClone(first), id: 'second-target', name: 'Second' };
    ir.named_selections.push(second);
    const material = { ...structuredClone(ir.materials[0]), id: 'replacement', name: 'Replacement' };
    ir.materials.push(material);
    useAppStore.getState().loadProject(ir);
    const plan = planAssignments(ir, 'material', material.id, [first.id, second.id]);
    expect(ir.material_assignments).toHaveLength(1);
    useAppStore.getState().mutateIR('assign', (draft) => Object.assign(draft, plan.patch));
    expect(useAppStore.getState().ir.material_assignments.map((item) => item.material_id)).toEqual([material.id, material.id]);
    useAppStore.getState().undo();
    expect(useAppStore.getState().ir).toEqual(ir);
  });

  it('rejects the entire batch when any target is incompatible or missing', () => {
    const before = structuredClone(ir);
    const vertex = ir.named_selections.find((item) => item.target_dimension === 0)!;
    expect(() => planAssignments(ir, 'section', ir.sections[0].id, [ir.section_assignments[0].target_named_selection_id, vertex.id])).toThrow('assignments.beamDimension');
    expect(() => planAssignments(ir, 'material', ir.materials[0].id, ['deleted'])).toThrow('bulk.missingEntity');
    expect(ir).toEqual(before);
  });
});
