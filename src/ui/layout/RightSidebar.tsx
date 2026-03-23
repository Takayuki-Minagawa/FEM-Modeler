import { useAppStore } from '@/state/store';

export function RightSidebar() {
  const activePanel = useAppStore((s) => s.activePanel);

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
          Properties
        </div>
        <div
          className="text-base p-5 rounded text-center leading-relaxed"
          style={{
            backgroundColor: 'var(--color-bg-input)',
            color: 'var(--color-text-muted)',
          }}
        >
          {activePanel === 'geometry' && 'Select or create a geometry body to edit its properties.'}
          {activePanel === 'selections' && 'Select entities in 3D to create a named selection.'}
          {activePanel === 'materials' && 'Add materials and assign them to named selections.'}
          {activePanel === 'sections' && 'Define cross-sections for frame/truss elements.'}
          {activePanel === 'mesh' && 'Configure mesh generation settings.'}
          {activePanel === 'bc' && 'Define boundary conditions on named selections.'}
          {activePanel === 'loads' && 'Define loads on named selections.'}
          {activePanel === 'ic' && 'Define initial conditions for transient analyses.'}
          {activePanel === 'analysis' && 'Configure analysis cases and solver settings.'}
          {activePanel === 'export' && 'Select solver targets and export your model.'}
          {activePanel === 'validation' && 'Review validation results before export.'}
        </div>
      </div>
    </div>
  );
}
