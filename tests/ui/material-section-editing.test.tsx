// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { useAppStore } from '@/state/store';
import { applyTemplate } from '@/lib/project-templates';
import { MaterialForm } from '@/ui/forms/MaterialForm';
import { SectionForm } from '@/ui/forms/SectionForm';
import { parseProjectFile } from '@/export/project/load';

beforeEach(async () => {
  await i18n.changeLanguage('en');
  useAppStore.getState().createProject('Thermal', 'thermal');
  applyTemplate('thermal', 'en');
});
afterEach(cleanup);

describe('material assignment editing', () => {
  it('exposes part material details with optional density and keeps old physical properties intact', async () => {
    const material = useAppStore.getState().ir.materials[0];
    render(<MaterialForm />);
    const row = screen.getByRole('button', { name: `Select ${material.name} (${material.id})` });
    row.focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('textbox', { name: 'Material Name' })).toBeTruthy();
    expect(screen.getByText('Changes apply immediately. Use Undo to revert them.')).toBeTruthy();
    expect(screen.getByRole('spinbutton', { name: 'Density (optional)' })).toBeTruthy();
    expect(screen.queryByRole('spinbutton', { name: 'Dynamic Viscosity μ' })).toBeNull();
    expect(screen.queryByRole('spinbutton', { name: 'Kinematic Viscosity ν' })).toBeNull();
    expect(screen.queryByRole('spinbutton', { name: "Young's Modulus" })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Class' })).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: 'Material notes' }), { target: { value: 'Fabricated member' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Material standard / source' }), { target: { value: 'Part specification' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Density (optional)' }), { target: { value: '' } });
    fireEvent.blur(screen.getByRole('spinbutton', { name: 'Density (optional)' }));
    const edited = useAppStore.getState().ir.materials[0];
    expect(edited.parameter_set).toEqual({ ...material.parameter_set, density: { value: null, status: 'missing' } });
    expect(edited.notes).toBe('Fabricated member');
    expect(edited.source).toBe('Part specification');
    expect(parseProjectFile(JSON.stringify(useAppStore.getState().ir)).data!.materials[0]).toEqual(edited);
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    expect(screen.getByRole('button', { name: `Delete ${material.name} (${material.id})` })).toBeTruthy();
  });

  it('previews replacement names before changing an assignment and restores the prior assignment with one Undo', () => {
    const store = useAppStore.getState();
    const original = store.ir.material_assignments[0];
    const selection = store.ir.named_selections.find((item) => item.id === original.target_named_selection_id)!;
    const replacement = { ...structuredClone(store.ir.materials[0]), id: 'replacement', name: 'Replacement' };
    store.addMaterial(replacement);
    render(<MaterialForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Assign To: Replacement (replacement)' }));
    fireEvent.click(screen.getByRole('button', { name: `Assign Replacement to ${selection.display_name ?? selection.name} (${selection.id})` }));
    expect(useAppStore.getState().ir.material_assignments).toEqual([original]);
    expect(screen.getByText(/Replace the assignment on .* from .* to Replacement/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Replace assignment' }));
    expect(useAppStore.getState().ir.material_assignments[0].material_id).toBe('replacement');
    expect(screen.getByRole('status').textContent).toContain('Replacement');
    fireEvent.click(screen.getByRole('button', { name: 'Undo this assignment' }));
    expect(useAppStore.getState().ir.material_assignments).toEqual([original]);
  });

  it('hides incompatible nodes by default and explains their disabled state on request', () => {
    const store = useAppStore.getState();
    store.addNamedSelection({ ...store.ir.named_selections[0], id: 'nodes', name: 'Nodes', display_name: 'Nodes', entity_type: 'vertex', target_dimension: 0, member_refs: [store.ir.geometry.vertices[0].id] });
    const material = store.ir.materials[0];
    render(<MaterialForm />);
    fireEvent.click(screen.getByRole('button', { name: `Assign To: ${material.name} (${material.id})` }));
    expect(screen.queryByRole('button', { name: /Assign .* to Nodes/ })).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show incompatible targets and reasons' }));
    expect((screen.getByRole('button', { name: /Assign .* to Nodes/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Materials require an edge, face or body; isolated nodes are incompatible.')).toBeTruthy();
  });

  it('adds distinct default and library names without renaming existing materials', () => {
    render(<MaterialForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Material' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Material' }));
    expect(useAppStore.getState().ir.materials.slice(-2).map((item) => item.name)).toEqual(['New Material', 'New Material 2']);
    expect(useAppStore.getState().ir.materials.at(-1)!.parameter_set.density.value).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'From Library' }));
    expect(screen.queryByRole('button', { name: /Water/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Steel \(SS400\)/ }));
    const libraryMaterial = useAppStore.getState().ir.materials.at(-1)!;
    expect(libraryMaterial.parameter_set.density.value).toBe(7850);
    expect(libraryMaterial.parameter_set.young_modulus.value).toBeNull();
  });
});

describe('section geometry editing', () => {
  it('preserves legacy manual properties on dimension edits and shows geometric properties without calculation controls', () => {
    render(<SectionForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Section' }));
    const section = useAppStore.getState().ir.sections[0];
    act(() => useAppStore.getState().updateSection(section.id, { area: 0.7654321, metadata: { property_mode: 'manual', property_source: 'manual', effective_length_factor: 1.7 } }));
    expect(screen.queryByRole('combobox', { name: 'Section property mode' })).toBeNull();
    expect(screen.queryByRole('spinbutton', { name: 'Area' })).toBeNull();
    expect(screen.queryByRole('spinbutton', { name: 'Torsion Constant J' })).toBeNull();
    expect(screen.queryByRole('spinbutton', { name: 'Effective Length Factor K' })).toBeNull();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Width' }), { target: { value: '0.8' } });
    expect(useAppStore.getState().ir.sections[0].area).toBe(0.7654321);
    expect(useAppStore.getState().ir.sections[0].metadata.property_source).toBe('manual');
    const saved = parseProjectFile(JSON.stringify(useAppStore.getState().ir));
    expect(saved.success).toBe(true);
    expect(saved.data!.sections[0].metadata.property_mode).toBe('manual');
    expect(saved.data!.sections[0].metadata.effective_length_factor).toBe(1.7);
    expect(screen.getByRole('region', { name: 'Geometric properties from section dimensions' }).textContent).toContain('0.4 m²');
    act(() => useAppStore.getState().undo());
    expect(useAppStore.getState().ir.sections[0].area).toBe(0.7654321);
    expect(useAppStore.getState().ir.sections[0].dimensions.width).toBe(0.3);
  });

  it('updates new section geometric properties from dimensions and keeps exact values through Undo', () => {
    render(<SectionForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Section' }));
    const before = useAppStore.getState().ir.sections[0];
    expect(before.metadata.effective_length_factor).toBeUndefined();
    expect(screen.queryByRole('option', { name: 'Existing generic section' })).toBeNull();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Width' }), { target: { value: '0.8123456789012345' } });
    expect(useAppStore.getState().ir.sections[0].area).toBe(0.8123456789012345 * 0.5);
    act(() => useAppStore.getState().undo());
    expect(useAppStore.getState().ir.sections[0]).toEqual(before);
  });

  it('hides unused shell properties and offers compatible face assignments', () => {
    render(<SectionForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Section' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Section Type' }), { target: { value: 'shell_thickness' } });
    expect(screen.queryByRole('spinbutton', { name: 'Area' })).toBeNull();
    expect(screen.queryByRole('spinbutton', { name: 'Moment of Inertia Iy' })).toBeNull();
    expect(screen.queryByRole('spinbutton', { name: 'Torsion Constant J' })).toBeNull();
    expect(screen.queryByRole('spinbutton', { name: 'Effective Length Factor K' })).toBeNull();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Thickness' }), { target: { value: '0.02' } });
    const section = useAppStore.getState().ir.sections[0];
    expect(section.thickness).toBe(0.02);
    fireEvent.click(screen.getByRole('button', { name: `Assign To: ${section.name} (${section.id})` }));
    const face = useAppStore.getState().ir.named_selections.find((selection) => selection.target_dimension === 2)!;
    const body = useAppStore.getState().ir.named_selections.find((selection) => selection.target_dimension === 3)!;
    expect((screen.getByRole('button', { name: `Assign ${section.name} to ${face.display_name ?? face.name} (${face.id})` }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole('button', { name: `Assign ${section.name} to ${body.display_name ?? body.name} (${body.id})` })).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show incompatible targets and reasons' }));
    expect((screen.getByRole('button', { name: `Assign ${section.name} to ${body.display_name ?? body.name} (${body.id})` }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Shell thickness requires a two-dimensional face selection.')).toBeTruthy();
  });
});
