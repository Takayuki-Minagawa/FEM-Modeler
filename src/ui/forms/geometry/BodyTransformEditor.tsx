import { geometryEditorJa, geometryEditorEn } from '@/i18n/locales/geometry-editor';
import { useState } from 'react';
import type { UnitSystemName, GeometryBody } from '@/core/ir/types';
import { fromSI, quantityUnitLabel, toSI } from '@/core/units';
import type { BodyUpdates } from '@/state/store';
import { TupleEditor } from './TupleEditor';
import { formatTuple, parseTuple, type TupleInput } from './tuple-inputs';

interface BodyEditorProps {
  body: GeometryBody;
  isJa: boolean;
  unitSystem: UnitSystemName;
  onApply: (updates: BodyUpdates) => void;
}

export function BodyTransformEditor({ body, isJa, unitSystem, onApply }: BodyEditorProps) {
  const copy = isJa ? geometryEditorJa : geometryEditorEn;
  const [bodyName, setBodyName] = useState(body.name);
  const [bodyVisible, setBodyVisible] = useState(body.visible);
  const [positionInputs, setPositionInputs] = useState<TupleInput>(formatTuple(body.transform.position.map((value) => fromSI(value, 'length', unitSystem)) as [number, number, number]));
  const [rotationInputs, setRotationInputs] = useState<TupleInput>(formatTuple(body.transform.rotation));
  const [scaleInputs, setScaleInputs] = useState<TupleInput>(formatTuple(body.transform.scale));
  const [error, setError] = useState('');

  return (
    <div className="space-y-3">
      <label
        className="block text-sm font-bold"
        style={{ color: 'var(--color-text-muted)' }}
      >
        {copy.bodyEdit}
      </label>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <label htmlFor={`body-name-${body.id}`} className="text-sm w-24 shrink-0" style={{ color: 'var(--color-text-secondary)' }}>
            {copy.name}
          </label>
          <input
            id={`body-name-${body.id}`}
            type="text"
            value={bodyName}
            onChange={(e) => setBodyName(e.target.value)}
            className="flex-1 px-2 py-1.5 rounded text-sm outline-none"
            style={{
              backgroundColor: 'var(--color-bg-input)',
              color: 'var(--color-text)',
              border: '1px solid var(--color-border)',
            }}
          />
        </div>

        <label
          className="flex items-center gap-2 text-sm"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          <input
            type="checkbox"
            checked={bodyVisible}
            onChange={(e) => setBodyVisible(e.target.checked)}
          />
          {copy.visible}
        </label>
      </div>

      <TupleEditor
        label={copy.position}
        values={positionInputs}
        onChange={setPositionInputs}
        step="0.1"
        unit={quantityUnitLabel('length', unitSystem)}
      />
      <TupleEditor
        label={copy.rotation}
        values={rotationInputs}
        onChange={setRotationInputs}
        step="1"
      />
      <TupleEditor
        label={copy.scale}
        values={scaleInputs}
        onChange={setScaleInputs}
        step="0.1"
      />

      <button
        type="button"
        onClick={() => {
          try {
            const updates: BodyUpdates = {};
            const nextName = bodyName.trim();
            if (nextName && nextName !== body.name) updates.name = nextName;
            if (bodyVisible !== body.visible) updates.visible = bodyVisible;
            const drafts = { position: positionInputs, rotation: rotationInputs, scale: scaleInputs };
            for (const key of ['position', 'rotation', 'scale'] as const) {
              const original = body.transform[key];
              const initial = formatTuple(original.map((number) => key === 'position' ? fromSI(number, 'length', unitSystem) : number) as [number, number, number]);
              if (drafts[key].every((text, index) => text === initial[index])) continue;
              const values = parseTuple(drafts[key], copy.invalidCoordinate);
              const next = values.map((number, index) => drafts[key][index] === initial[index] ? original[index] : key === 'position' ? toSI(number, 'length', unitSystem) : number) as [number, number, number];
              if (!next.every(Number.isFinite) || (key === 'scale' && next.some((number) => number === 0))) throw new Error(copy.invalidTransform);
              updates.transform = { ...updates.transform, [key]: next };
            }
            if (Object.keys(updates).length) onApply(updates);
            setError('');
          } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
        }}
        className="w-full py-2 rounded text-sm font-bold cursor-pointer transition-colors"
        style={{
          backgroundColor: 'var(--color-bg-input)',
          color: 'var(--color-text)',
          border: '1px solid var(--color-border)',
        }}
      >
        {copy.applyEdits}
      </button>
      {error && <p role="alert" className="text-xs" style={{ color: 'var(--color-error)' }}>{error}</p>}
    </div>
  );
}
