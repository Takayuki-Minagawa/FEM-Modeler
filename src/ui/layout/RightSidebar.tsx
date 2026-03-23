import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/state/store';

const PANEL_KEYS = [
  'geometry', 'selections', 'materials', 'sections', 'mesh',
  'bc', 'loads', 'ic', 'analysis', 'export', 'validation',
] as const;

export function RightSidebar() {
  const { t } = useTranslation();
  const activePanel = useAppStore((s) => s.activePanel);

  const message = PANEL_KEYS.includes(activePanel as typeof PANEL_KEYS[number])
    ? t(`properties.${activePanel}`)
    : '';

  return (
    <div
      className="h-full overflow-y-auto"
      style={{ backgroundColor: 'var(--color-bg-secondary)' }}
    >
      <div className="p-4">
        <div
          className="text-sm font-bold uppercase tracking-wider mb-4"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {t('properties.title')}
        </div>
        <div
          className="text-base p-5 rounded text-center leading-relaxed"
          style={{
            backgroundColor: 'var(--color-bg-input)',
            color: 'var(--color-text-muted)',
          }}
        >
          {message}
        </div>
      </div>
    </div>
  );
}
