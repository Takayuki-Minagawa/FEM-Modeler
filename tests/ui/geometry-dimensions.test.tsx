// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '@/state/store';
import { generateShape, DEFAULT_SHAPE_PARAMS } from '@/geometry/primitives/generators';
import { GeometryForm } from '@/ui/forms/GeometryForm';
import { DimensionEditor } from '@/ui/forms/geometry/DimensionEditor';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
afterEach(cleanup);
beforeEach(() => useAppStore.getState().createProject('dimensions'));
function addSelected(type: string) {
  const shape = generateShape(DEFAULT_SHAPE_PARAMS[type]);
  shape.body.transform.position = [1.234567890123456, 0, 0];
  useAppStore.getState().addBodyWithTopology(shape.body, shape);
  useAppStore.getState().setSelectedEntities([shape.body.id]);
  shape.threeGeometry.dispose();
  return shape.body;
}

describe('extended dimension editing', () => {
  it.each([['pipe', 'length'], ['plateWithHole', 'width'], ['lBracket', 'height'], ['frame2d', 'spanX'], ['truss2d', 'span'], ['channel', 'length']])('edits %s dimensions in display units while retaining untouched SI metadata', (shapeType, parameter) => {
    addSelected(shapeType);
    useAppStore.getState().setUnitSystem('mm-t-s');
    const before = useAppStore.getState().ir.geometry.bodies[0];
    render(<GeometryForm />);
    fireEvent.change(screen.getByLabelText(`Dimension ${parameter}`), { target: { value: '12345.6789012345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply dimensions' }));
    expect(useAppStore.getState().ir.geometry.bodies[0]).toEqual({ ...before, metadata: { ...before.metadata, [parameter]: 12.3456789012345 } });
    expect(screen.getByRole('status').textContent).toContain('Dimensions updated');
    act(() => useAppStore.getState().undo());
    expect(useAppStore.getState().ir.geometry.bodies[0]).toEqual(before);
  });

  it('keeps frame counts dimensionless and announces invalidated support selections before and after apply', () => {
    const body = addSelected('frame2d');
    const vertex = useAppStore.getState().ir.geometry.vertices[0];
    useAppStore.getState().addNamedSelection({ id: 'supports', name: 'Supports', entity_type: 'vertex', target_dimension: 0, member_refs: [vertex.id], status: 'active', color: '#fff', description: '', created_by: 'user', usages: ['boundary_condition'] });
    useAppStore.getState().setUnitSystem('mm-N-s');
    render(<GeometryForm />);
    expect((screen.getByLabelText('Dimension floors') as HTMLInputElement).value).toBe('3');
    fireEvent.change(screen.getByLabelText('Dimension floors'), { target: { value: '4' } });
    expect(screen.getByRole('note').textContent).toContain('become stale');
    fireEvent.click(screen.getByRole('button', { name: 'Apply dimensions' }));
    expect(useAppStore.getState().ir.geometry.bodies.find((item) => item.id === body.id)!.metadata.floors).toBe(4);
    expect(useAppStore.getState().ir.named_selections[0]).toMatchObject({ status: 'stale', member_refs: [] });
    expect(screen.getByRole('status').textContent).toContain('review: 1');
  });

  it('rejects incomplete dimensions and pipe radius conflicts atomically', () => {
    addSelected('pipe'); const before = useAppStore.getState().ir.geometry;
    render(<GeometryForm />);
    fireEvent.change(screen.getByLabelText('Dimension innerRadius'), { target: { value: '1e-' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply dimensions' }));
    expect(screen.getByRole('alert').textContent).toContain('finite dimensions');
    fireEvent.change(screen.getByLabelText('Dimension innerRadius'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply dimensions' }));
    expect(screen.getByRole('alert').textContent).toContain('smaller than outer');
    expect(useAppStore.getState().ir.geometry).toBe(before);
  });

  it('edits channel geometry without exposing analysis dimensionality and preserves existing metadata', () => {
    const body = addSelected('channel');
    useAppStore.getState().updateBody(body.id, { metadata: { ...body.metadata, dimensionality: '2D' } });
    render(<GeometryForm />);
    expect(screen.queryByLabelText('Dimension dimensionality')).toBeNull();
    expect(screen.queryByText('Use analysis case')).toBeNull();
    fireEvent.change(screen.getByLabelText('Dimension length'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply dimensions' }));
    expect(useAppStore.getState().ir.geometry.bodies[0].metadata.dimensionality).toBe('2D');
    expect(useAppStore.getState().ir.geometry.bodies[0].metadata.length).toBe(12);
  });

  it('does not create using a previous valid count when a draft exceeds its schema maximum', () => {
    render(<GeometryForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Cylinder', exact: true }));
    fireEvent.change(screen.getByLabelText('Segments'), { target: { value: '1001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Shape' }));
    expect(screen.getByRole('alert').textContent).toContain('invalid numeric parameters');
    expect(useAppStore.getState().ir.geometry.bodies).toHaveLength(0);
  });

  it('labels pipe values as radii in Japanese after extraction', () => {
    const body = addSelected('pipe');
    render(<DimensionEditor body={body} unitSystem="SI" isJa onApplied={() => {}} />);
    expect(screen.getByText(/外半径/)).toBeTruthy(); expect(screen.getByText(/内半径/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '寸法を適用' })).toBeTruthy();
  });
});
