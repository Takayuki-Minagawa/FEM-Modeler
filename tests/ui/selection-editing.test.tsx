// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { useAppStore } from '@/state/store';
import { generateShape } from '@/geometry/primitives/generators';
import { NamedSelectionsForm } from '@/ui/forms/NamedSelectionsForm';
import { parseProjectFile } from '@/export/project/load';

beforeEach(async () => { await i18n.changeLanguage('en'); useAppStore.getState().createProject('selection edits'); });
afterEach(cleanup);
function fixture(type: 'vertex' | 'face' | 'cell' = 'vertex') {
  const shape = generateShape({ shapeType: 'box', width: 2, height: 2, depth: 2 }, 'Part');
  useAppStore.getState().addBodyWithTopology(shape.body, shape); shape.threeGeometry.dispose();
  useAppStore.getState().addNamedSelection({ id: 'editable', name: 'Existing', entity_type: type, target_dimension: type === 'vertex' ? 0 : type === 'face' ? 2 : 3, member_refs: [type === 'face' ? shape.faces[0].id : type === 'cell' ? shape.body.id : shape.vertices[0].id], color: '#123456', description: '', created_by: 'user', status: 'active', usages: [] });
  render(<NamedSelectionsForm />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit Existing (editable)' }));
  return shape;
}
function preview() { fireEvent.click(screen.getByRole('button', { name: 'Preview membership', exact: true })); }
function apply() { fireEvent.click(screen.getByRole('button', { name: 'Apply membership' })); }
function selection() { return useAppStore.getState().ir.named_selections[0]; }

describe('named selection membership editor', () => {
  it('edits existing members only after preview/apply and restores the entire edit with Undo', () => {
    const shape = fixture();
    const before = selection();
    const list = screen.getByRole('listbox', { name: 'Selectable entities' });
    fireEvent.click(within(list).getByRole('option', { name: `Part / v1 / ${shape.vertices[1].id}` }));
    preview(); expect(selection()).toBe(before); expect(screen.getByText('1 → 2 members; 1 added, 0 removed; 2 candidates matched.')).toBeTruthy();
    apply(); expect(selection().member_refs).toEqual([shape.vertices[0].id, shape.vertices[1].id]); expect(selection().query_definition?.operation).toBe('add');
    act(() => useAppStore.getState().undo()); expect(selection()).toEqual(before);
    act(() => useAppStore.getState().redo()); expect(selection().member_refs).toHaveLength(2);
    expect(parseProjectFile(JSON.stringify(useAppStore.getState().ir)).data!.named_selections[0].query_definition).toEqual(selection().query_definition);
  });

  it('requires a fresh preview after changing model geometry or the numeric draft', () => {
    const shape = fixture();
    fireEvent.change(screen.getByLabelText('Set operation'), { target: { value: 'replace' } });
    fireEvent.change(screen.getByLabelText('Candidate rule'), { target: { value: 'coordinate_range' } });
    fireEvent.change(screen.getByLabelText('Minimum (m)'), { target: { value: '0' } }); preview();
    expect(screen.getByText('1 → 4 members; 4 added, 1 removed; 4 candidates matched.')).toBeTruthy();
    act(() => useAppStore.getState().updateBody(shape.body.id, { transform: { ...shape.body.transform, position: [10, 0, 0] } }));
    expect((screen.getByRole('button', { name: 'Apply membership' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('The model or query changed after preview. Preview again before applying.')).toBeTruthy();
    preview(); expect(screen.getByText('1 → 8 members; 7 added, 0 removed; 8 candidates matched.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Minimum (m)'), { target: { value: '1e-' } }); preview();
    expect(screen.getByText(/Enter complete finite values/)).toBeTruthy(); expect(selection().member_refs).toHaveLength(1);
  });

  it('supports remove, replace, invert and explicitly marks an empty selection unresolved', () => {
    fixture();
    fireEvent.change(screen.getByLabelText('Set operation'), { target: { value: 'remove' } }); preview(); apply();
    expect(selection().member_refs).toHaveLength(0); expect(selection().status).toBe('unresolved');
    fireEvent.change(screen.getByLabelText('Set operation'), { target: { value: 'invert' } }); preview(); apply(); expect(selection().member_refs).toHaveLength(8);
    fireEvent.change(screen.getByLabelText('Set operation'), { target: { value: 'replace' } }); preview(); apply(); expect(selection().member_refs).toHaveLength(1);
  });

  it('previews saved criteria against changed geometry, preserving explicit evaluation until apply', () => {
    const shape = fixture();
    fireEvent.change(screen.getByLabelText('Set operation'), { target: { value: 'replace' } });
    fireEvent.change(screen.getByLabelText('Candidate rule'), { target: { value: 'coordinate_range' } });
    fireEvent.change(screen.getByLabelText('Minimum (m)'), { target: { value: '0' } }); preview(); apply();
    act(() => useAppStore.getState().updateBody(shape.body.id, { transform: { ...shape.body.transform, position: [-10, 0, 0] } }));
    expect(selection().member_refs).toHaveLength(4);
    fireEvent.change(screen.getByLabelText('Minimum (m)'), { target: { value: '-' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview saved rule' }));
    expect(screen.getByText('4 → 0 members; 0 added, 4 removed; 0 candidates matched.')).toBeTruthy();
    expect(selection().member_refs).toHaveLength(4); apply(); expect(selection().member_refs).toHaveLength(0);
  });

  it('offers signed normal queries for faces and excludes every opposite face', () => {
    const shape = fixture('face');
    fireEvent.change(screen.getByLabelText('Set operation'), { target: { value: 'replace' } });
    fireEvent.change(screen.getByLabelText('Candidate rule'), { target: { value: 'face_normal' } });
    fireEvent.change(screen.getByLabelText('Normal direction X'), { target: { value: '-1' } });
    preview(); apply(); expect(selection().member_refs).toEqual([shape.faces.find((face) => face.name === 'left')!.id]);
  });

  it('keeps cell selections read-only instead of treating stored body IDs as a geometry selection', () => {
    fixture('cell');
    expect(screen.getByText(/This selection uses cell entities/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Apply membership' })).toBeNull();
    expect(selection().entity_type).toBe('cell');
  });
});
