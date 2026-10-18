// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '@/state/store';
import { GeometryForm } from '@/ui/forms/GeometryForm';
import { MaterialForm } from '@/ui/forms/MaterialForm';
import { SectionForm } from '@/ui/forms/SectionForm';
import { uniqueEntityName } from '@/core/ir/names';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
afterEach(cleanup);
beforeEach(() => { useAppStore.getState().createProject('names', 'frame'); });

describe('new UI entity names', () => {
  it.each(([
    [GeometryForm, 'Create Shape', () => useAppStore.getState().ir.geometry.bodies],
    [MaterialForm, 'materials.addMaterial', () => useAppStore.getState().ir.materials],
    [SectionForm, 'sections.addSection', () => useAppStore.getState().ir.sections],
  ] as const).map(([Form, addName, entities]) => ({ Form, addName, entities })))('assigns distinct names with $addName', ({ Form, addName, entities }) => {
    render(<Form />);
    const initial = entities().length;
    fireEvent.click(screen.getByRole('button', { name: addName }));
    const first = entities()[initial].name;
    fireEvent.click(screen.getByRole('button', { name: addName }));
    expect(entities().slice(initial).map((entity) => entity.name)).toEqual([first, `${first} 2`]);
    act(() => useAppStore.getState().undo());
    expect(entities().slice(initial).map((entity) => entity.name)).toEqual([first]);
    fireEvent.click(screen.getByRole('button', { name: addName }));
    expect(entities().slice(initial).map((entity) => entity.name)).toEqual([first, `${first} 2`]);
  });

  it('skips occupied suffixes and leaves supplied names intact', () => {
    const existing = [{ name: 'New Section' }, { name: 'New Section 2' }, { name: 'New Section 4' }];
    expect(uniqueEntityName('New Section', existing)).toBe('New Section 3');
    expect(existing.map((item) => item.name)).toEqual(['New Section', 'New Section 2', 'New Section 4']);
    expect(uniqueEntityName('Imported name', existing)).toBe('Imported name');
  });
});
