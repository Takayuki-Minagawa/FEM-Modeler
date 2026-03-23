import { useAppStore } from '@/state/store';

const TREE_SECTIONS = [
  { key: 'geometry', label: 'Geometry', icon: '&#9651;' },
  { key: 'selections', label: 'Named Selections', icon: '&#9632;' },
  { key: 'materials', label: 'Materials', icon: '&#9673;' },
  { key: 'sections', label: 'Sections', icon: '&#9634;' },
  { key: 'mesh', label: 'Mesh Controls', icon: '&#9638;' },
  { key: 'bc', label: 'Boundary Conditions', icon: '&#9654;' },
  { key: 'loads', label: 'Loads', icon: '&#8595;' },
  { key: 'ic', label: 'Initial Conditions', icon: '&#8635;' },
  { key: 'analysis', label: 'Analysis Cases', icon: '&#9881;' },
  { key: 'export', label: 'Solver Targets', icon: '&#8680;' },
  { key: 'validation', label: 'Validation', icon: '&#10003;' },
] as const;

export function LeftSidebar() {
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
      case 'export': return ir.solver_targets.filter((t) => t.enabled).length;
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
          Project Tree
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
              <span className="truncate flex-1">{section.label}</span>
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
