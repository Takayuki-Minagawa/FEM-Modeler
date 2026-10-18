import { useState, type InputHTMLAttributes } from 'react';
import { parseFiniteNumber } from './numeric';

interface NumericDraftInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'min' | 'max'> {
  value: string;
  onValueChange: (text: string) => void;
  min?: number;
  max?: number;
  integer?: boolean;
}

/** String drafts retain empty, sign and exponent prefixes until their owner commits. */
export function NumericDraftInput({ value, onValueChange, min, max, integer, step = 'any', onKeyDown, ...props }: NumericDraftInputProps) {
  const parsed = parseFiniteNumber(value);
  return <input {...props} type="text" inputMode="decimal" role="spinbutton"
    value={value} aria-valuenow={parsed ?? undefined} aria-valuemin={min} aria-valuemax={max}
    onChange={(event) => onValueChange(event.target.value)}
    onKeyDown={(event) => {
      onKeyDown?.(event);
      if (event.defaultPrevented || props.disabled || props.readOnly || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const increment = step === 'any' ? 1 : Number(step);
      let next = (parsed ?? 0) + (event.key === 'ArrowUp' ? 1 : -1) * increment;
      if (integer) next = Math.round(next);
      if (min !== undefined) next = Math.max(min, next);
      if (max !== undefined) next = Math.min(max, next);
      if (Number.isFinite(next)) onValueChange(String(next));
    }} />;
}

interface NumericFieldProps extends Omit<NumericDraftInputProps, 'value' | 'onValueChange'> {
  value: number | null;
  onValueChange: (value: number | null) => void;
  allowNull?: boolean;
  onDraftChange?: (text: string) => void;
}

/** Valid numbers retain the forms' immediate update behavior; incomplete text stays local. */
export function NumericField({ value, onValueChange, onDraftChange, allowNull = false, min, max, integer, onBlur, ...props }: NumericFieldProps) {
  const [draft, setDraft] = useState({ source: value, text: value === null ? '' : String(value) });
  if (!Object.is(draft.source, value)) {
    setDraft({ source: value, text: value === null ? '' : String(value) });
  }
  const text = Object.is(draft.source, value) ? draft.text : value === null ? '' : String(value);
  const parsed = parseFiniteNumber(text);
  const valid = parsed !== null && (min === undefined || parsed >= min) && (max === undefined || parsed <= max) && (!integer || Number.isInteger(parsed));
  return <NumericDraftInput {...props} value={text} min={min} max={max} integer={integer}
    aria-invalid={props['aria-invalid'] ?? (!valid && !(allowNull && text.trim() === '') ? true : undefined)}
    onValueChange={(next) => {
      onDraftChange?.(next);
      const number = parseFiniteNumber(next);
      const acceptable = number !== null && (min === undefined || number >= min) && (max === undefined || number <= max) && (!integer || Number.isInteger(number));
      setDraft({ source: acceptable ? number : value, text: next });
      if (acceptable && !Object.is(number, value)) onValueChange(number);
    }}
    onBlur={(event) => {
      if (allowNull && text.trim() === '' && value !== null) {
        setDraft({ source: null, text: '' });
        onValueChange(null);
      }
      onBlur?.(event);
    }} />;
}
