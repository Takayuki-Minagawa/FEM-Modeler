// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { useAppStore } from '@/state/store';
import { generateShape } from '@/geometry/primitives/generators';
import { NamedSelectionsForm } from '@/ui/forms/NamedSelectionsForm';
import { EntityRow } from '@/ui/forms/common/EntityRow';
import { FormField } from '@/ui/forms/common/FormField';
import { ViewerControls } from '@/viewer/ViewerControls';
import { useViewerState } from '@/viewer/view-state';
import { createMaterialFromLibrary, MATERIAL_LIBRARY } from '@/lib/material-library';

beforeEach(async () => { await i18n.changeLanguage('en'); useAppStore.getState().createModelProject('workflow'); });
afterEach(cleanup);

describe('accessible entity workflows', () => {
  it('offers separate keyboard actions with unique target names and selected state', async () => {
    const user = userEvent.setup(); const select = vi.fn(); const remove = vi.fn();
    render(<EntityRow name="Same name" entityId="body_1" selected onSelect={select} onDelete={remove}>description</EntityRow>);
    const button = screen.getByRole('button', { name: 'Select Same name (body_1)' });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.getAttribute('data-entity-id')).toBe('body_1');
    button.focus(); await user.keyboard('{Enter}'); await user.keyboard(' ');
    expect(select).toHaveBeenCalledTimes(2);
    await user.tab(); await user.keyboard('{Enter}');
    expect(remove).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledTimes(2);
  });

  it('connects a field label and error to the exact input', () => {
    render(<FormField label="Name" error="A name is required">{(attributes) => <input {...attributes} />}</FormField>);
    const input = screen.getByLabelText('Name');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id);
  });

  it('disambiguates same-named faces with owner/ID and keeps selections across search', () => {
    const one = generateShape({ shapeType: 'box', width: 1, height: 1, depth: 1 }, 'First');
    const two = generateShape({ shapeType: 'box', width: 1, height: 1, depth: 1 }, 'Second');
    useAppStore.getState().addBodyWithTopology(one.body, one); useAppStore.getState().addBodyWithTopology(two.body, two);
    one.threeGeometry.dispose(); two.threeGeometry.dispose();
    render(<NamedSelectionsForm />);
    fireEvent.click(screen.getByRole('button', { name: 'face', exact: true }));
    const list = screen.getByRole('listbox', { name: 'Selectable entities' });
    const face = one.faces.find((item) => item.name === 'top')!;
    fireEvent.click(within(list).getByRole('option', { name: `First / top / ${face.id}` }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Second / top' } });
    expect(within(list).getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('status').textContent).toBe('1 selected / 12 available');
    fireEvent.change(screen.getByLabelText('Selection name'), { target: { value: 'Support' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create', exact: true }));
    expect(useAppStore.getState().ir.named_selections[0].member_refs).toEqual([face.id]);
    expect(screen.getByRole('button', { name: /Select Support/ }).getAttribute('data-entity-id')).toBeTruthy();
  });

  it('shows model material assignments without requiring an analysis case', () => {
    useAppStore.getState().createModelProject('Frame', 'frame', 'en');
    useAppStore.getState().mutateIR('Assign material', (draft) => {
      const material = createMaterialFromLibrary(MATERIAL_LIBRARY[0], 'en');
      draft.materials.push(material);
      draft.material_assignments.push({ id: 'material-assignment', material_id: material.id, target_named_selection_id: draft.named_selections[0].id, override_allowed: false });
    });
    const ir = useAppStore.getState().ir;
    expect(ir.analysis_cases).toHaveLength(0);
    expect(ir.material_assignments.length).toBeGreaterThan(0);
    useViewerState.getState().set({ showMaterials: true });
    render(<ViewerControls />);
    expect(screen.getByText('Colors identify the named selections with assigned materials.')).toBeTruthy();
    expect(screen.getByRole('button', { name: i18n.t('workflow.targetZoom', { name: `${ir.materials[0].name} (material-assignment)` }) })).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByText('Conditions')).toBeNull();
    act(() => useViewerState.getState().set({ showMaterials: false }));
  });
});
