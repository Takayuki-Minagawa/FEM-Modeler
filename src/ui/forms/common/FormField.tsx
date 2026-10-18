import { useId, type ReactNode } from 'react';

interface FieldAttributes { id: string; 'aria-describedby'?: string; 'aria-invalid'?: true }
interface FormFieldProps {
  label: string;
  hint?: string;
  error?: string;
  children: (attributes: FieldAttributes) => ReactNode;
}

export function FormField({ label, hint, error, children }: FormFieldProps) {
  const id = useId();
  const description = hint || error ? `${id}-description` : undefined;
  return <div className="space-y-1">
    <label htmlFor={id} className="block text-sm" style={{ color: 'var(--color-text-secondary)' }}>{label}</label>
    {children({ id, 'aria-describedby': description, 'aria-invalid': error ? true : undefined })}
    {description && <p id={description} role={error ? 'alert' : undefined} className="text-xs" style={{ color: error ? 'var(--color-error)' : 'var(--color-text-muted)' }}>{error ?? hint}</p>}
  </div>;
}
