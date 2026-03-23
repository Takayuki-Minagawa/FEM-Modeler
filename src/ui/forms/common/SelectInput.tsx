interface SelectInputProps {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (val: string) => void;
  disabled?: boolean;
}

export function SelectInput({ label, value, options, onChange, disabled }: SelectInputProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm w-28 shrink-0" style={{ color: 'var(--color-text-secondary)' }}>
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="flex-1 px-2 py-1.5 rounded text-sm outline-none cursor-pointer disabled:opacity-50"
        style={{
          backgroundColor: 'var(--color-bg-input)',
          color: 'var(--color-text)',
          border: '1px solid var(--color-border)',
        }}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
