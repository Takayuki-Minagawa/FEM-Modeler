// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { useAppStore } from '@/state/store';
import { generateShape } from '@/geometry/primitives/generators';
import { GeometryForm } from '@/ui/forms/GeometryForm';
import { NumericField } from '@/ui/forms/common/NumericField';
import { parseFiniteNumber } from '@/ui/forms/common/numeric';
import { parseProjectFile } from '@/export/project/load';
import { useViewerState } from '@/viewer/view-state';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
afterEach(cleanup);
beforeEach(() => { useAppStore.getState().createProject('editing'); });

function addSelectedBox() {
  const shape = generateShape({ shapeType: 'box', width: 2, height: 2, depth: 2 }, 'Precision body');
  shape.body.transform = { position: [0.00001234, 1.23456789012345, -8.76543210987654e-12], rotation: [0.0000001234567, 12.3456789123456, -0.0000123456789], scale: [1.23456789123456, 0.99999999999987, 1.00000000000013] };
  useAppStore.getState().addBodyWithTopology(shape.body, shape);
  useAppStore.getState().setSelectedEntities([shape.body.id]);
  shape.threeGeometry.dispose();
  return shape.body.id;
}

describe('geometry edits through the form', () => {
  it.each(['SI', 'mm-N-s', 'mm-t-s'] as const)('keeps exact transforms during name/visibility changes in %s and project roundtrip', (units) => {
    addSelectedBox();
    useAppStore.getState().setUnitSystem(units);
    const before = useAppStore.getState().ir.geometry.bodies[0].transform;
    render(<GeometryForm />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed body' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply Edits' }));
    expect(useAppStore.getState().ir.geometry.bodies[0].transform).toBe(before);
    fireEvent.click(screen.getByLabelText('Visible'));
    fireEvent.click(screen.getByRole('button', { name: 'Apply Edits' }));
    expect(useAppStore.getState().ir.geometry.bodies[0].transform).toBe(before);
    const saved = parseProjectFile(JSON.stringify(useAppStore.getState().ir));
    expect(saved.success).toBe(true);
    expect(saved.data!.geometry.bodies[0].transform).toEqual(before);
    act(() => useAppStore.getState().setUnitSystem(units === 'SI' ? 'mm-N-s' : 'SI'));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'After units' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply Edits' }));
    expect(useAppStore.getState().ir.geometry.bodies[0].transform).toBe(before);
  });

  it('commits only the edited coordinate and rejects incomplete transform input visibly', () => {
    addSelectedBox();
    useAppStore.getState().setUnitSystem('mm-N-s');
    const before = useAppStore.getState().ir.geometry.bodies[0].transform;
    render(<GeometryForm />);
    fireEvent.change(screen.getByLabelText('Position X'), { target: { value: '-1.234e-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply Edits' }));
    const after = useAppStore.getState().ir.geometry.bodies[0].transform;
    expect(after.position).toEqual([-0.00001234, before.position[1], before.position[2]]);
    expect(after.rotation).toEqual(before.rotation); expect(after.scale).toEqual(before.scale);
    fireEvent.change(screen.getByLabelText('Position X'), { target: { value: '1e-' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply Edits' }));
    expect(screen.getByRole('alert').textContent).toContain('complete finite number');
    expect(useAppStore.getState().ir.geometry.bodies[0].transform).toBe(after);
  });

  it('creates a pattern through the real store and reports rejected input without creating bodies', () => {
    addSelectedBox();
    const before = useAppStore.getState().ir.geometry;
    render(<GeometryForm />);
    fireEvent.change(screen.getByLabelText('Copies'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Offset X'), { target: { value: '2.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Pattern Copies' }));
    expect(useAppStore.getState().ir.geometry.bodies).toHaveLength(3);
    expect(screen.getByRole('status').textContent).toContain('2 body copies');
    act(() => useAppStore.getState().undo());
    expect(useAppStore.getState().ir.geometry).toEqual(before);
    act(() => useAppStore.getState().setSelectedEntities([before.bodies[0].id]));
    fireEvent.change(screen.getByLabelText('Copies'), { target: { value: '1000000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Pattern Copies' }));
    expect(screen.getByRole('alert').textContent).toContain('between 1 and 100');
    expect(useAppStore.getState().ir.geometry.bodies).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Copies'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Offset X'), { target: { value: String(Number.MAX_VALUE) } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Pattern Copies' }));
    expect(screen.getByRole('alert').textContent).toContain('coordinate range');
    expect(useAppStore.getState().ir.geometry.bodies).toHaveLength(1);
  });

  it('does not create from a stale valid parameter after an incomplete edit', () => {
    render(<GeometryForm />);
    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '1e-' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Shape' }));
    expect(screen.getByRole('alert').textContent).toContain('invalid numeric parameters');
    expect(useAppStore.getState().ir.geometry.bodies).toHaveLength(0);
  });

  it('creates at the entered position in display units and requests a matching camera fit', () => {
    useAppStore.getState().setUnitSystem('mm-N-s');
    render(<GeometryForm />);
    fireEvent.change(screen.getByLabelText('Creation position X'), { target: { value: '12500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Shape' }));
    const body = useAppStore.getState().ir.geometry.bodies[0];
    expect(body.transform.position).toEqual([12.5, 0, 0]);
    const points = useViewerState.getState().focus!.points;
    expect(Math.min(...points.map((point) => point[0]))).toBe(11.5);
    expect(Math.max(...points.map((point) => point[0]))).toBe(13.5);
  });

  it('clears invalid creation drafts when display units reset the fields', () => {
    render(<GeometryForm />);
    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '-' } });
    act(() => useAppStore.getState().setUnitSystem('mm-N-s'));
    act(() => useAppStore.getState().setUnitSystem('SI'));
    fireEvent.click(screen.getByRole('button', { name: 'Create Shape' }));
    expect(useAppStore.getState().ir.geometry.bodies).toHaveLength(1);
  });
});

describe('numeric text drafts', () => {
  it('keeps sign/exponent text while preserving valid-number immediate updates', async () => {
    const observed: Array<number | null> = [];
    function Harness() {
      const [value, setValue] = useState<number | null>(9);
      return <NumericField aria-label="value" value={value} allowNull onValueChange={(next) => { observed.push(next); setValue(next); }} />;
    }
    render(<Harness />);
    const user = userEvent.setup(); const input = screen.getByRole('spinbutton', { name: 'value' });
    await user.clear(input);
    expect(observed).toEqual([]);
    await user.type(input, '-');
    expect((input as HTMLInputElement).value).toBe('-'); expect(observed).toEqual([]);
    await user.type(input, '1e-');
    expect((input as HTMLInputElement).value).toBe('-1e-'); expect(observed).toEqual([-1]);
    await user.type(input, '3');
    expect(observed.at(-1)).toBe(-0.001);
    await user.clear(input); await user.tab();
    expect(observed.at(-1)).toBeNull();
  });
  it.each(['', '-', '1e-', '1m', 'Infinity', 'NaN', '0x10'])('rejects incomplete or non-decimal input %j', (text) => {
    expect(parseFiniteNumber(text)).toBeNull();
  });
});
