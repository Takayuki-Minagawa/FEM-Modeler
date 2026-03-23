interface UnitInputProps {
  label: string;
  value: number | null;
  unit: string;
  onChange: (val: number | null) => void;
  status?: string;
  step?: number;
  min?: number;
  disabled?: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  confirmed: 'var(--color-success)',
  library: 'var(--color-info)',
  inferred: 'var(--color-warning)',
  missing: 'var(--color-error)',
  needs_review: 'var(--color-warning)',
  imported: 'var(--color-info)',
};

export function UnitInput({ label, value, unit, onChange, status, step = 0.01, min, disabled }: UnitInputProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm w-28 shrink-0" style={{ color: 'var(--color-text-secondary)' }}>
        {label}
      </span>
      <div className="flex-1 flex items-center gap-1">
        <input
          type="number"
          value={value ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v === '' ? null : parseFloat(v));
          }}
          step={step}
          min={min}
          disabled={disabled}
          placeholder="—"
          className="flex-1 px-2 py-1.5 rounded text-sm outline-none disabled:opacity-50"
          style={{
            backgroundColor: 'var(--color-bg-input)',
            color: 'var(--color-text)',
            border: '1px solid var(--color-border)',
          }}
        />
        <span className="text-xs shrink-0 w-12 text-right" style={{ color: 'var(--color-text-muted)' }}>
          {unit}
        </span>
      </div>
      {status && (
        <span
          className="w-2 h-2 rounded-full shrink-0"
          title={status}
          style={{ backgroundColor: STATUS_COLORS[status] ?? 'var(--color-text-muted)' }}
        />
      )}
    </div>
  );
}
