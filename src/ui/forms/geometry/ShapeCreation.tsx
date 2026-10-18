import { geometryEditorJa, geometryEditorEn } from '@/i18n/locales/geometry-editor';
import { useState } from 'react';
import type { UnitSystemName } from '@/core/ir/types';
import { fromSI, quantityUnitLabel, toSI } from '@/core/units';
import { useAppStore } from '@/state/store';
import { generateShape, DEFAULT_SHAPE_PARAMS } from '@/geometry/primitives/generators';
import { uniqueEntityName } from '@/core/ir/names';
import { shapesJa, shapesEn, paramLabelsJa, paramLabelsEn } from '@/i18n/locales/shapes';
import type { AnyShapeParams } from '@/geometry/primitives/types';
import { NumericField } from '../common/NumericField';
import { parseFiniteNumber } from '../common/numeric';
import { bodyFocusPoints } from '@/viewer/focus-bounds';
import { useViewerState } from '@/viewer/view-state';
import { AXIS_LABELS } from './tuple-inputs';
import { nativeShapeParameters } from '@/core/ir/schema/shapes';

const SHAPE_TYPES = Object.keys(DEFAULT_SHAPE_PARAMS);

export function ShapeCreation({ isJa, unitSystem }: { isJa: boolean; unitSystem: UnitSystemName }) {
  const copy = isJa ? geometryEditorJa : geometryEditorEn;
  const [creationError, setCreationError] = useState('');
  const [invalidParameters, setInvalidParameters] = useState<Record<string, boolean>>({});
  const [creationPosition, setCreationPosition] = useState<[number, number, number]>([0, 0, 0]);
  const [parameterUnit, setParameterUnit] = useState(unitSystem);
  if (parameterUnit !== unitSystem) {
    setParameterUnit(unitSystem);
    setInvalidParameters({});
  }
  const [selectedShape, setSelectedShape] = useState('box');
  const [params, setParams] = useState<Record<string, unknown>>(
    () => ({ ...DEFAULT_SHAPE_PARAMS['box'] }),
  );

  const shapeNames = isJa ? shapesJa : shapesEn;
  const paramLabels = isJa ? paramLabelsJa : paramLabelsEn;
  const lengthUnit = quantityUnitLabel('length', unitSystem);
  const handleShapeChange = (type: string) => {
    setSelectedShape(type);
    setParams({ ...DEFAULT_SHAPE_PARAMS[type] });
    setInvalidParameters((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) => key.includes(':position'))));
    setCreationError('');
  };

  const handleParamChange = (key: string, num: number | null) => {
    if (num !== null) {
      setParams((prev) => ({
        ...prev,
        [key]: nativeShapeParameters(selectedShape).find((parameter) => parameter.key === key)?.kind === 'count' ? num : toSI(num, 'length', unitSystem),
      }));
    }
  };

  const handleCreate = () => {
    try {
    if (Object.entries(invalidParameters).some(([key, invalid]) => key.startsWith(`${unitSystem}:`) && invalid)) throw new Error(copy.invalidCreation);
    const shapeParams = { ...params, shapeType: selectedShape } as AnyShapeParams;
    const result = generateShape(shapeParams, uniqueEntityName(shapeNames[selectedShape], useAppStore.getState().ir.geometry.bodies));
    result.body.transform.position = [...creationPosition];
    const store = useAppStore.getState();
    store.addBodyWithTopology(result.body, {
      faces: result.faces,
      edges: result.edges,
      vertices: result.vertices,
    });
    useViewerState.getState().set({ resultId: '', fieldId: '', probe: null });
    useViewerState.getState().focusPoints(bodyFocusPoints(result.body));
    result.threeGeometry.dispose();
    setCreationError('');
    } catch (error) { setCreationError(error instanceof Error ? error.message : String(error)); }
  };

  const parameters = nativeShapeParameters(selectedShape).filter(({ key }) => key !== 'dimensionality');
  return <>
      {/* Shape creation */}
      <div>
        <label
          className="block text-sm font-bold mb-2"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {copy.shapeType}
        </label>
        <div className="grid grid-cols-3 gap-1.5">
          {SHAPE_TYPES.map((type) => (
            <button
              key={type}
              onClick={() => handleShapeChange(type)}
              className="px-2 py-2 rounded text-xs text-center transition-colors cursor-pointer"
              style={{
                backgroundColor: selectedShape === type ? 'var(--color-accent)' : 'var(--color-bg-input)',
                color: selectedShape === type ? '#fff' : 'var(--color-text-secondary)',
                border: `1px solid ${selectedShape === type ? 'var(--color-accent)' : 'var(--color-border)'}`,
              }}
            >
              {shapeNames[type]}
            </button>
          ))}
        </div>
      </div>

      {/* Parameters */}
      <div>
        <label
          className="block text-sm font-bold mb-2"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {copy.parameters}
        </label>
        <div className="space-y-2">
          {parameters.map(({ key, kind, min, max, options }) => (
            <div key={key} className="flex items-center gap-2">
              <label
                htmlFor={`geometry-param-${key}`}
                className="text-sm w-24 shrink-0"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {paramLabels[key] ?? key}
              </label>
              {kind === 'choice' ? <select id={`geometry-param-${key}`} value={String(params[key] ?? '')} onChange={(event) => setParams((previous) => ({ ...previous, [key]: event.target.value || undefined }))} className="flex-1 px-2 py-1.5 rounded text-sm" style={{ backgroundColor: 'var(--color-bg-input)' }}>
                <option value="">—</option>
                {options?.map((option) => <option key={option}>{option}</option>)}
              </select> : <NumericField
                key={`${key}:${unitSystem}:${selectedShape}`}
                id={`geometry-param-${key}`}
                value={kind === 'count' ? params[key] as number : fromSI(params[key] as number, 'length', unitSystem)}
                onValueChange={(number) => handleParamChange(key, number)}
                onDraftChange={(text) => {
                  const number = parseFiniteNumber(text);
                  setInvalidParameters((previous) => ({ ...previous, [`${unitSystem}:${key}`]: number === null || number <= 0 || (min !== undefined && number < min) || (max !== undefined && number > max) || (kind === 'count' && !Number.isInteger(number)) }));
                }}
                step={kind === 'count' ? 1 : 0.1}
                min={min}
                max={max}
                integer={kind === 'count'}
                className="flex-1 px-2 py-1.5 rounded text-sm outline-none"
                style={{
                  backgroundColor: 'var(--color-bg-input)',
                  color: 'var(--color-text)',
                  border: '1px solid var(--color-border)',
                }}
              />}
              {kind === 'length' && <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{lengthUnit}</span>}
            </div>
          ))}
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-bold">{copy.creationPosition} [{lengthUnit}]</legend>
        <div className="grid grid-cols-3 gap-2">
          {AXIS_LABELS.map((axis, index) => <label key={axis} className="text-xs">{axis}
            <NumericField key={`${axis}:${unitSystem}`} aria-label={`${copy.creationPosition} ${axis}`}
              value={fromSI(creationPosition[index], 'length', unitSystem)}
              onValueChange={(number) => {
                if (number === null) return;
                const next = [...creationPosition] as [number, number, number];
                next[index] = toSI(number, 'length', unitSystem);
                setCreationPosition(next);
              }}
              onDraftChange={(text) => setInvalidParameters((previous) => ({ ...previous, [`${unitSystem}:position${axis}`]: parseFiniteNumber(text) === null }))}
              className="w-full px-2 py-1.5 rounded text-sm" style={{ backgroundColor: 'var(--color-bg-input)', border: '1px solid var(--color-border)' }} />
          </label>)}
        </div>
      </fieldset>

      {/* Create button */}
      <button
        onClick={handleCreate}
        className="w-full py-2.5 rounded text-sm font-bold cursor-pointer transition-colors"
        style={{
          backgroundColor: 'var(--color-accent)',
          color: '#fff',
        }}
      >
        {copy.createShape}
      </button>

      {creationError && <p role="alert" className="text-xs" style={{ color: "var(--color-error)" }}>{creationError}</p>}
  </>;
}
