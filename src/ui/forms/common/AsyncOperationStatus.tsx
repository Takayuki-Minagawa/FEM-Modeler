import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { AsyncOperation } from '@/hooks/useAsyncOperation';

/** Progress is indeterminate unless the producer can measure its work. */
export function AsyncOperationStatus({ operation, onCancel, cancelLabel, children }: {
  operation: AsyncOperation | null; onCancel?: () => void; cancelLabel?: string; children?: ReactNode;
}) {
  const { t } = useTranslation();
  if (!operation) return null;
  const running = operation.status === 'running';
  return <div role="status" aria-live="polite" aria-busy={running} className="p-3 rounded text-xs space-y-2" style={{ backgroundColor: 'var(--color-bg-input)' }}>
    <p style={{ color: operation.status === 'failed' ? 'var(--color-error)' : operation.status === 'completed' ? 'var(--color-success)' : 'var(--color-text-secondary)' }}>
      {operation.label}: {t(`asyncOperation.${operation.status}`)}
    </p>
    {running && <div className="flex flex-wrap items-center gap-2">
      <progress aria-label={t(`asyncOperation.phases.${operation.phase}`)} className="max-w-full" />
      <span>{t(`asyncOperation.phases.${operation.phase}`)}</span>
      {onCancel && <button type="button" onClick={onCancel} className="underline cursor-pointer">{cancelLabel ?? t('asyncOperation.cancel')}</button>}
    </div>}
    {operation.message && <p>{operation.message}</p>}
    <p className="break-all" style={{ color: 'var(--color-text-muted)' }}>{t('asyncOperation.id', { id: operation.id })}</p>
    {children}
  </div>;
}
