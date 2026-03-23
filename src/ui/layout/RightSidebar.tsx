import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/state/store';
import { GeometryForm } from '@/ui/forms/GeometryForm';
import { NamedSelectionsForm } from '@/ui/forms/NamedSelectionsForm';

const PANELS_WITH_FORMS = ['geometry', 'selections'] as const;

const PANEL_I18N_KEYS = [
  'geometry', 'selections', 'materials', 'sections', 'mesh',
  'bc', 'loads', 'ic', 'analysis', 'export', 'validation',
] as const;

export function RightSidebar() {
  const { t } = useTranslation();
  const activePanel = useAppStore((s) => s.activePanel);

  const hasForm = (PANELS_WITH_FORMS as readonly string[]).includes(activePanel);

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

        {activePanel === 'geometry' && <GeometryForm />}
        {activePanel === 'selections' && <NamedSelectionsForm />}

        {!hasForm && (PANEL_I18N_KEYS as readonly string[]).includes(activePanel) && (
          <div
            className="text-base p-5 rounded text-center leading-relaxed"
            style={{
              backgroundColor: 'var(--color-bg-input)',
              color: 'var(--color-text-muted)',
            }}
          >
            {t(`properties.${activePanel}`)}
          </div>
        )}
      </div>
    </div>
  );
}
