interface VectorInputProps {
  label: string;
  value: [number, number, number];
  onChange: (val: [number, number, number]) => void;
  labels?: [string, string, string];
}

export function VectorInput({ label, value, onChange, labels = ['X', 'Y', 'Z'] }: VectorInputProps) {
  const handleChange = (idx: number, v: string) => {
    const num = parseFloat(v);
    if (isNaN(num)) return;
    const next = [...value] as [number, number, number];
    next[idx] = num;
    onChange(next);
  };

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm w-28 shrink-0" style={{ color: 'var(--color-text-secondary)' }}>
        {label}
      </span>
      <div className="flex-1 flex gap-1">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex-1 flex items-center gap-0.5">
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {labels[i]}
            </span>
            <input
              type="number"
              value={value[i]}
              onChange={(e) => handleChange(i, e.target.value)}
              step={0.1}
              className="w-full px-1.5 py-1.5 rounded text-sm outline-none"
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
