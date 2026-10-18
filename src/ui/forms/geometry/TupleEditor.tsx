import { NumericDraftInput } from '../common/NumericField';
import { AXIS_LABELS, updateTupleInput, type TupleInput } from './tuple-inputs';
interface TupleEditorProps {
  label: string;
  values: TupleInput;
  onChange: (values: TupleInput) => void;
  step: string;
  min?: number;
  unit?: string;
}

export function TupleEditor({
  label,
  values,
  onChange,
  step,
  min,
  unit,
}: TupleEditorProps) {
  return (
    <div>
      <label
        className="block text-sm font-bold mb-2"
        style={{ color: 'var(--color-text-muted)' }}
      >
        {label}{unit ? ` [${unit}]` : ''}
      </label>
      <div className="grid grid-cols-3 gap-2">
        {AXIS_LABELS.map((axis, index) => (
          <div key={axis} className="space-y-1">
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {axis}
            </span>
            <NumericDraftInput
              aria-label={`${label} ${axis}`}
              value={values[index]}
              onValueChange={(text) => onChange(updateTupleInput(values, index, text))}
              step={step}
              min={min}
              className="w-full px-2 py-1.5 rounded text-sm outline-none"
              style={{
                backgroundColor: 'var(--color-bg-input)',
                color: 'var(--color-text)',
                border: '1px solid var(--color-border)',
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
