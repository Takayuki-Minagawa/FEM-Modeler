import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

interface EntityRowProps {
  name: string;
  entityId?: string;
  selected?: boolean;
  onSelect: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  children?: ReactNode;
  color?: string;
}

/** The primary action and secondary actions are separate native buttons. */
export function EntityRow({ name, entityId, selected = false, onSelect, onEdit, onDelete, children, color }: EntityRowProps) {
  const { t } = useTranslation();
  const identity = entityId ? `${name} (${entityId})` : name;
  return <div className="flex items-center gap-1 rounded text-sm" style={{ backgroundColor: selected ? 'var(--color-bg-panel)' : 'var(--color-bg-input)' }}>
    <button type="button" data-entity-id={entityId} aria-label={t('workflow.selectEntity', { name: identity })} aria-pressed={selected} onClick={onSelect} className="flex-1 min-w-0 p-2 text-left cursor-pointer">
      <span className="flex items-center gap-2 break-words">{color && <span aria-hidden="true" className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: color }} />}{name}</span>
      {children && <span className="block mt-1 text-xs break-words" style={{ color: 'var(--color-text-muted)' }}>{children}</span>}
    </button>
    {onEdit && <button type="button" aria-label={t('workflow.editEntity', { name: identity })} onClick={onEdit} className="p-2 cursor-pointer">✎</button>}
    {onDelete && <button type="button" aria-label={t('workflow.deleteEntity', { name: identity })} onClick={onDelete} className="p-2 cursor-pointer" style={{ color: 'var(--color-error)' }}>×</button>}
  </div>;
}
