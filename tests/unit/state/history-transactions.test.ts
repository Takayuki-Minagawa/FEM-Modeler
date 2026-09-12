import { beforeEach, describe, expect, it } from 'vitest';
import { produceWithPatches } from 'immer';
import { createDefaultProject } from '@/core/ir/defaults';
import { useAppStore, getHistoryStats } from '@/state/store';
import { createUndoRedoManager } from '@/state/middleware/undo-redo';
import { applyTemplate } from '@/lib/project-templates';

beforeEach(() => useAppStore.getState().createProject('history', 'frame'));
describe('direct recipe history', () => {
  it('retains the exact unmodified large asset and result references across edits and undo', () => {
    const ir = createDefaultProject();
    ir.assets = [{ id: 'asset', data: 'A'.repeat(10 * 1024 * 1024) }] as never;
    ir.results = [{ id: 'result', fields: [{ values: Array.from({ length: 100_000 }, (_, i) => i) }] }] as never;
    useAppStore.getState().loadProject(ir);
    const before = useAppStore.getState().ir;
    for (let i = 0; i < 100; i++) useAppStore.getState().setProjectName(`edit ${i}`);
    const after = useAppStore.getState().ir;
    expect(after.assets).toBe(before.assets);
    expect(after.results).toBe(before.results);
    expect(getHistoryStats().estimatedBytes).toBeLessThan(256_000);
    useAppStore.getState().undo();
    expect(useAppStore.getState().ir.assets).toBe(before.assets);
    expect(useAppStore.getState().ir.results).toBe(before.results);
    expect(useAppStore.getState().ir.meta.project_name).toBe('edit 98');
    useAppStore.getState().redo();
    expect(useAppStore.getState().ir.meta.project_name).toBe('edit 99');
  });

  it('removes multiple bodies with their references in one reversible operation', () => {
    applyTemplate('frame', 'en');
    const ir = useAppStore.getState().ir;
    const ids = ir.geometry.bodies.slice(0, 2).map((body) => body.id);
    useAppStore.getState().setSelectedEntities(ids);
    useAppStore.getState().removeBodies([...ids, ids[0], 'missing']);
    expect(useAppStore.getState().ir.geometry.bodies.some((body) => ids.includes(body.id))).toBe(false);
    expect(useAppStore.getState().selectedEntityIds).toEqual([]);
    useAppStore.getState().undo();
    expect(useAppStore.getState().ir.geometry).toEqual(ir.geometry);
    expect(useAppStore.getState().ir.named_selections).toEqual(ir.named_selections);
    expect(useAppStore.getState().ir.material_assignments).toEqual(ir.material_assignments);
    expect(useAppStore.getState().ir.boundary_conditions).toEqual(ir.boundary_conditions);
    expect(useAppStore.getState().ir.loads).toEqual(ir.loads);
  });

  it('enforces both history count and byte limits, including oversized entries', () => {
    const manager = createUndoRedoManager({ maxEntries: 2, maxBytes: 2048 });
    let ir = createDefaultProject();
    for (let i = 0; i < 3; i++) {
      const [next, patches, inverse] = produceWithPatches(ir, (draft) => { draft.meta.project_name = `edit ${i}`; });
      manager.record(patches, inverse); ir = next;
    }
    expect(manager.stats().undoEntries).toBe(2);
    expect(manager.stats().estimatedBytes).toBeLessThanOrEqual(2048);
    const [, patches, inverse] = produceWithPatches(ir, (draft) => { draft.meta.project_name = 'x'.repeat(4096); });
    manager.record(patches, inverse);
    expect(manager.stats()).toEqual({ undoEntries: 0, redoEntries: 0, estimatedBytes: 0 });
  });

  it('keeps current derived validation when undoing unrelated edits and clears the redo branch', () => {
    const store = useAppStore.getState();
    store.setProjectName('A'); store.setProjectName('B'); store.undo();
    store.runValidation();
    const checks = useAppStore.getState().ir.validation;
    store.setProjectName('C');
    expect(useAppStore.getState().canRedo).toBe(false);
    expect(useAppStore.getState().ir.validation).toBe(checks);
  });
});

it('retains Undo for deleting a 10 MiB STL body within the default memory budget', async () => {
  const { importSTL } = await import('@/geometry/import/stl-loader');
  const bytes = new TextEncoder().encode('solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t');
  const imported = importSTL(bytes.buffer, 'triangle.stl');
  const ir = createDefaultProject();
  ir.geometry.bodies.push(imported.body!); ir.geometry.faces.push(...imported.faces!);
  ir.assets.push({ ...imported.asset!, data: 'A'.repeat(Math.ceil(10 * 1024 * 1024 * 4 / 3)), byte_length: 10 * 1024 * 1024 });
  useAppStore.getState().loadProject(ir);
  const asset = useAppStore.getState().ir.assets[0];
  useAppStore.getState().removeBodies([imported.body!.id]);
  expect(useAppStore.getState().ir.assets).toEqual([]);
  expect(useAppStore.getState().canUndo).toBe(true);
  expect(getHistoryStats().estimatedBytes).toBeLessThan(64 * 1024 * 1024);
  useAppStore.getState().undo();
  expect(useAppStore.getState().ir.assets[0]).toEqual(asset);
  expect(useAppStore.getState().ir.geometry.bodies[0].id).toBe(imported.body!.id);
});
