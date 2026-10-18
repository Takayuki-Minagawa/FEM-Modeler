import { geometryEditorJa, geometryEditorEn } from '@/i18n/locales/geometry-editor';
import { useState } from 'react';
import type { UnitSystemName } from '@/core/ir/types';
import { fromSI, quantityUnitLabel, toSI } from '@/core/units';
import { NumericDraftInput } from '../common/NumericField';
import { parseFiniteNumber } from '../common/numeric';
import { MAX_PATTERN_COPIES } from '@/geometry/editing';
import { TupleEditor } from './TupleEditor';
import { parseTuple, type TupleInput } from './tuple-inputs';

interface LinearPatternEditorProps {
  bodyIds: string[];
  defaultOffset: TupleInput;
  isJa: boolean;
  unitSystem: UnitSystemName;
  onCreate: (copies: number, offset: [number, number, number]) => void;
}

export function LinearPatternEditor({
  bodyIds,
  defaultOffset,
  isJa,
  unitSystem,
  onCreate,
}: LinearPatternEditorProps) {
  const copy = isJa ? geometryEditorJa : geometryEditorEn;
  const [patternCopies, setPatternCopies] = useState('1');
  const [patternOffset, setPatternOffset] = useState<TupleInput>(() => defaultOffset.map((value) => `${fromSI(Number(value), 'length', unitSystem)}`) as TupleInput);
  const [error, setError] = useState('');

  return (
    <div className="space-y-3">
      <label
        className="block text-sm font-bold"
        style={{ color: 'var(--color-text-muted)' }}
      >
        {copy.pattern}
      </label>

      <div className="flex items-center gap-2">
        <label htmlFor="pattern-copies" className="text-sm w-24 shrink-0" style={{ color: 'var(--color-text-secondary)' }}>
          {copy.copies}
        </label>
        <NumericDraftInput
          id="pattern-copies"
          min={1}
          max={MAX_PATTERN_COPIES}
          integer
          step={1}
          value={patternCopies}
          onValueChange={setPatternCopies}
          className="flex-1 px-2 py-1.5 rounded text-sm outline-none"
          style={{
            backgroundColor: 'var(--color-bg-input)',
            color: 'var(--color-text)',
            border: '1px solid var(--color-border)',
          }}
        />
      </div>

      <TupleEditor
        label={copy.offset}
        values={patternOffset}
        onChange={setPatternOffset}
        step="0.1"
        unit={quantityUnitLabel('length', unitSystem)}
      />

      <button
        type="button"
        onClick={() => {
          try {
            const copies = parseFiniteNumber(patternCopies);
            if (copies === null || !Number.isInteger(copies) || copies < 1 || copies > MAX_PATTERN_COPIES) throw new Error(copy.patternCountError.replace('{{max}}', String(MAX_PATTERN_COPIES)));
            if (bodyIds.length === 0) throw new Error(copy.selectBody);
            onCreate(copies, parseTuple(patternOffset, copy.invalidCoordinate).map((value) => toSI(value, 'length', unitSystem)) as [number, number, number]);
            setError('');
          } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
        }}
        className="w-full py-2 rounded text-sm font-bold cursor-pointer transition-colors"
        style={{
          backgroundColor: 'var(--color-accent)',
          color: '#fff',
        }}
      >
        {copy.createCopies}
      </button>
      <p className="text-xs">{copy.patternLimit.replace('{{max}}', String(MAX_PATTERN_COPIES))}</p>
      {error && <p role="alert" className="text-xs" style={{ color: 'var(--color-error)' }}>{error}</p>}
    </div>
  );
}
