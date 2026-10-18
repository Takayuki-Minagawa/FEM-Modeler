import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/state/store';

const TREE_SECTIONS = [
  { key: 'geometry', i18nKey: 'tree.geometry', icon: '&#9651;' },
  { key: 'selections', i18nKey: 'tree.selections', icon: '&#9632;' },
  { key: 'materials', i18nKey: 'tree.materials', icon: '&#9673;' },
  { key: 'sections', i18nKey: 'tree.sections', icon: '&#9634;' },
  { key: 'export', i18nKey: 'tree.export', icon: '&#8680;' },
  { key: 'validation', i18nKey: 'tree.validation', icon: '&#10003;' },
] as const;

export function LeftSidebar({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const { t } = useTranslation();
  const activePanel = useAppStore((s) => s.activePanel);
  const setActivePanel = useAppStore((s) => s.setActivePanel);
  const ir = useAppStore((s) => s.ir);

  function getCount(key: string): number {
    switch (key) {
      case 'geometry': return ir.geometry.bodies.length;
      case 'selections': return ir.named_selections.length;
      case 'materials': return ir.materials.length;
      case 'sections': return ir.sections.length;
      case 'validation': return ir.validation.model_context?.kind === 'model'
        ? ir.validation.summary.error_count + ir.validation.summary.warning_count : 0;
      default: return 0;
    }
  }

  return (
    <nav aria-label={t('workflow.modelTree')}
      className="h-full overflow-y-auto overflow-x-hidden select-none"
      style={{ backgroundColor: 'var(--color-bg-secondary)', minWidth: 0 }}
    >
      <div className={collapsed ? 'p-1' : 'p-3'}>
        {!collapsed && <div
          className="text-sm font-bold uppercase tracking-wider mb-3 px-2 whitespace-nowrap"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {t('tree.title')}
        </div>}
        {TREE_SECTIONS.map((section) => {
          const isActive = activePanel === section.key;
          const count = getCount(section.key);
          return (
            <button
              key={section.key}
              onClick={() => { setActivePanel(section.key); onNavigate?.(); }}
              aria-label={t(section.i18nKey)}
              aria-current={isActive ? 'page' : undefined}
              title={collapsed ? t(section.i18nKey) : undefined}
              className={`w-full text-left py-2.5 rounded text-base flex items-center transition-colors cursor-pointer ${collapsed ? 'px-2 justify-center' : 'px-3 gap-3'}`}
              style={{
                backgroundColor: isActive ? 'var(--color-bg-panel)' : 'transparent',
                color: isActive ? 'var(--color-text)' : 'var(--color-text-secondary)',
              }}
            >
              <span
                dangerouslySetInnerHTML={{ __html: section.icon }}
                className="w-5 shrink-0 text-center text-sm"
              />
              {!collapsed && <span className="truncate flex-1">{t(section.i18nKey)}</span>}
              {!collapsed && count > 0 && (
                <span
                  className="text-sm px-2 py-0.5 rounded-full shrink-0"
                  style={{
                    backgroundColor: 'var(--color-bg-input)',
                    color: 'var(--color-text-muted)',
                  }}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
