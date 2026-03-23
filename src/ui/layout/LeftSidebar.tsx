import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/state/store';

const TREE_SECTIONS = [
  { key: 'geometry', i18nKey: 'tree.geometry', icon: '&#9651;' },
  { key: 'selections', i18nKey: 'tree.selections', icon: '&#9632;' },
  { key: 'materials', i18nKey: 'tree.materials', icon: '&#9673;' },
  { key: 'sections', i18nKey: 'tree.sections', icon: '&#9634;' },
  { key: 'mesh', i18nKey: 'tree.mesh', icon: '&#9638;' },
  { key: 'bc', i18nKey: 'tree.bc', icon: '&#9654;' },
  { key: 'loads', i18nKey: 'tree.loads', icon: '&#8595;' },
  { key: 'ic', i18nKey: 'tree.ic', icon: '&#8635;' },
  { key: 'analysis', i18nKey: 'tree.analysis', icon: '&#9881;' },
  { key: 'export', i18nKey: 'tree.export', icon: '&#8680;' },
  { key: 'validation', i18nKey: 'tree.validation', icon: '&#10003;' },
] as const;

export function LeftSidebar() {
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
      case 'mesh': return ir.mesh_controls.local.length;
      case 'bc': return ir.boundary_conditions.length;
      case 'loads': return ir.loads.length;
      case 'ic': return ir.initial_conditions.length;
      case 'analysis': return ir.analysis_cases.length;
      case 'export': return ir.solver_targets.filter((st) => st.enabled).length;
      case 'validation': return ir.validation.summary.error_count + ir.validation.summary.warning_count;
      default: return 0;
    }
  }

  return (
    <div
      className="h-full overflow-y-auto overflow-x-hidden select-none"
      style={{ backgroundColor: 'var(--color-bg-secondary)', minWidth: 0 }}
    >
      <div className="p-3">
        <div
          className="text-sm font-bold uppercase tracking-wider mb-3 px-2 whitespace-nowrap"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {t('tree.title')}
        </div>
        {TREE_SECTIONS.map((section) => {
          const isActive = activePanel === section.key;
          const count = getCount(section.key);
          return (
            <button
              key={section.key}
              onClick={() => setActivePanel(section.key)}
              className="w-full text-left px-3 py-2.5 rounded text-base flex items-center gap-3 transition-colors cursor-pointer"
              style={{
                backgroundColor: isActive ? 'var(--color-bg-panel)' : 'transparent',
                color: isActive ? 'var(--color-text)' : 'var(--color-text-secondary)',
              }}
            >
              <span
                dangerouslySetInnerHTML={{ __html: section.icon }}
                className="w-5 shrink-0 text-center text-sm"
              />
              <span className="truncate flex-1">{t(section.i18nKey)}</span>
              {count > 0 && (
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
    </div>
  );
}
