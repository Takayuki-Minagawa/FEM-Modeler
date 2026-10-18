import { geometryEditorJa, geometryEditorEn } from '@/i18n/locales/geometry-editor';
import { useState } from 'react';
import type { GeometryBody, UnitSystemName } from '@/core/ir/types';
import { nativeShapeParameters } from '@/core/ir/schema/shapes';
import { fromSI, quantityUnitLabel, toSI } from '@/core/units';
import { regeneratePrimitive } from '@/geometry/regeneration';
import { useAppStore } from '@/state/store';
import { paramLabelsJa, paramLabelsEn } from '@/i18n/locales/shapes';
import { NumericDraftInput } from '../common/NumericField';
import { parseFiniteNumber } from '../common/numeric';

export function DimensionEditor({ body, isJa, unitSystem, onApplied }: { body: GeometryBody; isJa: boolean; unitSystem: UnitSystemName; onApplied: (message: string) => void }) {
  const copy = isJa ? geometryEditorJa : geometryEditorEn;
  const parameters = nativeShapeParameters(String(body.metadata.shapeType)).filter(({ key }) => key !== 'dimensionality');
  const initial = Object.fromEntries(parameters.map(({ key, kind }) => [key, String(kind === 'length' ? fromSI(Number(body.metadata[key]), 'length', unitSystem) : body.metadata[key] ?? '')]));
  const [values, setValues] = useState(initial);
  const [error, setError] = useState('');
  const topologyChange = parameters.some(({ key, changesTopology }) => changesTopology && values[key] !== initial[key] && (parseFiniteNumber(values[key]) ?? values[key]) !== (parseFiniteNumber(initial[key]) ?? initial[key]));
  return <section className="space-y-2 p-3 rounded" style={{ backgroundColor: 'var(--color-bg-input)' }}>
    <h3 className="text-sm font-bold">{copy.dimensions}</h3>
    <p className="text-xs">{copy.dimensionsPreserved}</p>
    {topologyChange && <p role="note" className="text-xs" style={{ color: 'var(--color-warning)' }}>{copy.topologyWarning}</p>}
    {parameters.map(({ key, kind, min, max, options }) => <label key={key} className="flex items-center justify-between text-xs gap-2">{(isJa ? paramLabelsJa : paramLabelsEn)[key] ?? key}{kind === 'length' ? ` [${quantityUnitLabel('length', unitSystem)}]` : ''}
      {kind === 'choice' ? <select aria-label={`${copy.dimensionField} ${isJa ? paramLabelsJa[key] ?? key : key}`} value={values[key]} onChange={(event) => setValues({ ...values, [key]: event.target.value })}>
        <option value="">—</option>
        {options?.map((option) => <option key={option}>{option}</option>)}
      </select> : <NumericDraftInput aria-label={`${copy.dimensionField} ${isJa ? paramLabelsJa[key] ?? key : key}`} className="w-24" value={values[key]} min={min} max={max} integer={kind === 'count'} step={kind === 'count' ? 1 : 'any'} onValueChange={(text) => setValues({ ...values, [key]: text })} />}
    </label>)}
    <button type="button" disabled={body.locked} className="w-full py-2 rounded text-sm" style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }} onClick={() => {
      try {
        const changed = Object.fromEntries(parameters.flatMap<[string, number | string | undefined]>(({ key, kind }) => {
          if (values[key] === initial[key]) return [];
          if (kind === 'choice') return [[key, values[key] || undefined]];
          const number = parseFiniteNumber(values[key]);
          if (number === null) throw new Error(copy.invalidDimensions);
          // Keep untouched canonical SI values exact, even when display-unit conversion is lossy.
          return [[key, kind === 'count' ? number : toSI(number, 'length', unitSystem)]];
        }));
        if (!Object.keys(changed).length) { setError(''); return; }
        const before = useAppStore.getState().ir.named_selections;
        useAppStore.getState().mutateIR('Regenerate primitive dimensions', (ir) => regeneratePrimitive(ir, body.id, changed));
        const stale = useAppStore.getState().ir.named_selections.filter((selection, index) => selection.status === 'stale' && selection !== before[index]).length;
        onApplied(copy.dimensionsUpdated.replace('{{count}}', String(stale)));
        setError('');
      } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    }}>{copy.applyDimensions}</button>
    {error && <p role="alert" className="text-xs" style={{ color: 'var(--color-error)' }}>{error}</p>}
  </section>;
}
