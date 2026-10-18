import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateReferences } from '@/core/ir/relations';
import { createProjectBundle, parseProjectBundle } from '@/export/project/bundle';
import { parseProjectFile } from '@/export/project/load';
import { serializeProject } from '@/export/project/save';
import { MODEL_TEMPLATES, MODELING_PANELS, applyModelTemplate, createModelProject } from '@/modeling/project';
import { getHistoryStats, useAppStore } from '@/state/store';

describe('modeling project templates', () => {
  it.each(MODEL_TEMPLATES)('creates a %s model with no analysis setup and a valid file round trip', (template) => {
    const ir = createModelProject('部材構成', template, 'ja');
    expect(ir.meta.project_name).toBe('部材構成');
    expect(ir.meta.default_solver_target).toBe('');
    expect(ir.solver_targets.every((target) => !target.enabled)).toBe(true);
    expect(ir.boundary_conditions).toEqual([]);
    expect(ir.loads).toEqual([]);
    expect(ir.initial_conditions).toEqual([]);
    expect(ir.analysis_cases).toEqual([]);
    expect(ir.results).toEqual([]);
    expect(ir.convergence_studies).toEqual([]);
    expect(ir.geometry.bodies).toHaveLength(template === 'empty' ? 0 : 1);
    expect(validateReferences(ir)).toEqual([]);
    const loaded = parseProjectFile(serializeProject(ir));
    expect(loaded.success, loaded.error).toBe(true);
    expect(loaded.data?.geometry).toEqual(ir.geometry);
    expect(loaded.data?.named_selections).toEqual(ir.named_selections);
    expect(loaded.data?.solver_targets).toEqual(ir.solver_targets);
  });

  it.each(['frame', 'truss'] as const)('partitions all %s members into named composition groups', (template) => {
    const ir = createModelProject('members', template, 'en');
    const groups = ir.named_selections.filter((selection) => selection.entity_type === 'edge');
    const members = groups.flatMap((selection) => selection.member_refs);
    expect(groups).toHaveLength(template === 'frame' ? 2 : 3);
    expect(new Set(members).size).toBe(members.length);
    expect(new Set(members)).toEqual(new Set(ir.geometry.edges.map((edge) => edge.id)));
    expect(groups.every((selection) => selection.target_dimension === 1 && selection.usages.includes('section_assignment'))).toBe(true);
    expect(ir.named_selections.every((selection) => selection.usages.every((usage) => ['material_assignment', 'section_assignment', 'export_tag'].includes(usage)))).toBe(true);
  });

  it('appends templates immutably with distinct IDs and names and preserves existing data', () => {
    const original = createModelProject('assembly', 'frame', 'en');
    const originalJson = JSON.stringify(original);
    const changed = applyModelTemplate(applyModelTemplate(original, 'frame', 'en'), 'plate', 'en');
    expect(JSON.stringify(original)).toBe(originalJson);
    expect(changed.geometry.model_type).toBe('hybrid');
    expect(changed.geometry.bodies.map((body) => body.name)).toEqual(['Frame', 'Frame 2', 'Plate']);
    expect(new Set(changed.named_selections.map((selection) => selection.name)).size).toBe(changed.named_selections.length);
    expect(new Set(changed.named_selections.map((selection) => selection.display_name)).size).toBe(changed.named_selections.length);
    expect(changed.geometry.bodies[0]).toBe(original.geometry.bodies[0]);
    expect(validateReferences(changed)).toEqual([]);
  });
});

describe('modeling store and legacy file preservation', () => {
  beforeEach(() => useAppStore.getState().createModelProject('blank', 'empty', 'en'));

  it('starts a new modeling session with cleared selection/history and optional localized naming', () => {
    const previous = useAppStore.getState();
    previous.setProjectName('edited');
    previous.setSelectedEntities(['old-body']);
    previous.setHoveredEntity('old-body');
    previous.createModelProject(undefined, 'pipe', 'ja-JP');
    const current = useAppStore.getState();
    expect(current.projectSession).toBe(previous.projectSession + 1);
    expect(current.ir.meta.project_name).toBe('名称未設定のモデル');
    expect(current.ir.geometry.bodies[0].name).toBe('パイプ');
    expect(current.selectedEntityIds).toEqual([]);
    expect(current.hoveredEntityId).toBeNull();
    expect(current.activePanel).toBe('geometry');
    expect(current.isStartScreenOpen).toBe(false);
    expect(current.canUndo).toBe(false);
    expect(current.canRedo).toBe(false);
    expect(getHistoryStats().undoEntries).toBe(0);
  });

  it('limits UI navigation to modeling panels', () => {
    for (const panel of MODELING_PANELS) {
      useAppStore.getState().setActivePanel(panel);
      expect(useAppStore.getState().activePanel).toBe(panel);
    }
    for (const panel of ['results', 'loads', 'boundary_conditions', 'analysis', 'unknown', '']) {
      useAppStore.getState().setActivePanel(panel);
      expect(useAppStore.getState().activePanel).toBe('geometry');
    }
  });

  it('preserves hidden legacy data through JSON and Bundle while reopening in a modeling panel', async () => {
    const parsed = parseProjectFile(readFileSync(new URL('../../fixtures/thermal-benchmark/project.json', import.meta.url), 'utf8'));
    expect(parsed.success, parsed.error).toBe(true);
    const legacy = parsed.data!;
    legacy.ui_state.active_panel = 'results';
    legacy.results.push({
      id: 'legacy_result', analysis_case_id: legacy.analysis_cases[0].id, solver_target: 'DOLFINx',
      source_file_name: 'external.csv', imported_at: new Date(0).toISOString(), status: 'partial',
      fields: [], checks: [], metadata: { source: 'external' },
    });
    useAppStore.getState().loadProject(legacy);
    expect(useAppStore.getState().activePanel).toBe('geometry');
    expect(useAppStore.getState().ir.ui_state.active_panel).toBe('results');
    useAppStore.getState().setProjectName('renamed model');
    const saved = useAppStore.getState().ir;
    const json = parseProjectFile(serializeProject(saved));
    expect(json.success, json.error).toBe(true);
    const bundle = await parseProjectBundle(await (await createProjectBundle(saved)).arrayBuffer());
    expect(bundle.success, bundle.error).toBe(true);
    for (const loaded of [json.data!, bundle.data!]) {
      expect(loaded.analysis_cases).toEqual(legacy.analysis_cases);
      expect(loaded.boundary_conditions).toEqual(legacy.boundary_conditions);
      expect(loaded.loads).toEqual(legacy.loads);
      expect(loaded.mesh_controls).toEqual(legacy.mesh_controls);
      expect(loaded.results).toEqual(legacy.results);
      expect(loaded.solver_targets).toEqual(legacy.solver_targets);
    }
  });

  it('keeps model checks derived so they do not add Undo entries or change model revision', () => {
    const store = useAppStore.getState();
    store.createModelProject('shape', 'plate', 'en');
    store.setProjectName('renamed');
    const before = useAppStore.getState().ir;
    const history = getHistoryStats();
    store.runModelValidation();
    const validated = useAppStore.getState().ir;
    expect(validated.validation.model_revision).toBe(before.validation.model_revision);
    expect(validated.validation.validated_revision).toBe(before.validation.model_revision);
    expect(validated.validation.last_run_at).not.toBe('');
    expect(getHistoryStats()).toEqual(history);
  });
});
