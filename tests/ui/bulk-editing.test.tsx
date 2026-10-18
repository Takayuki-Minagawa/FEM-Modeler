// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { useAppStore } from '@/state/store';
import { applyTemplate } from '@/lib/project-templates';
import { MaterialForm } from '@/ui/forms/MaterialForm';
import { BatchAssignmentAction } from '@/ui/forms/common/BulkActions';

beforeEach(async () => {
  await i18n.changeLanguage('en');
  useAppStore.getState().createProject('Batch', 'frame');
  applyTemplate('frame', 'en');
});
afterEach(cleanup);

describe('batch editing workflow', () => {
  it('duplicates a material into the editor with original assignments intact and one-click Undo', () => {
    const before = useAppStore.getState().ir;
    const material = before.materials[0];
    render(<MaterialForm />);
    fireEvent.click(screen.getByRole('button', { name: `Select ${material.name} (${material.id})` }));
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate', exact: true }));
    expect((screen.getByRole('textbox', { name: 'Material Name' }) as HTMLInputElement).value).toBe(`${material.name} (copy)`);
    expect(useAppStore.getState().ir.material_assignments).toEqual(before.material_assignments);
    fireEvent.click(screen.getByRole('button', { name: 'Undo this batch' }));
    expect(useAppStore.getState().ir).toEqual(before);
  });

  it('previews all assignment differences and disables application after an intervening edit', () => {
    const store = useAppStore.getState();
    const first = store.ir.named_selections.find((selection) => selection.id === store.ir.material_assignments[0].target_named_selection_id)!;
    store.addNamedSelection({ ...structuredClone(first), id: 'extra', name: 'Extra', display_name: 'Extra' });
    store.addMaterial({ ...structuredClone(store.ir.materials[0]), id: 'new-mat', name: 'New material' });
    const before = useAppStore.getState().ir;
    render(<BatchAssignmentAction kind="material" itemId="new-mat" />);
    fireEvent.click(screen.getByText('Assign to multiple targets'));
    for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box);
    fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }));
    expect(screen.getByText('Extra: — → New material')).toBeTruthy();
    expect(useAppStore.getState().ir).toBe(before);
    act(() => useAppStore.getState().setProjectName('Changed'));
    expect((screen.getByRole('button', { name: 'Apply batch' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply batch' }));
    expect(useAppStore.getState().ir.material_assignments).toHaveLength(2);
    expect(useAppStore.getState().ir.material_assignments.every((assignment) => assignment.material_id === 'new-mat')).toBe(true);
    expect(within(screen.getByRole('status')).getByText('Assigned New material to 2 targets.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo this batch' }));
    expect(useAppStore.getState().ir.material_assignments).toEqual(before.material_assignments);
  });
});
