import { useAppStore } from '@/state/store';
import { readFileAsText, parseProjectFile } from '@/export/project/load';
import type { DomainType } from '@/core/ir/types';

const TEMPLATES: { name: string; domain: DomainType; description: string }[] = [
  { name: 'Empty Project', domain: 'frame', description: 'Start from scratch' },
  { name: '2D Frame', domain: 'frame', description: 'Portal frame structure (OpenSeesPy)' },
  { name: '3D Truss', domain: 'truss', description: 'Space truss structure (OpenSeesPy)' },
  { name: 'Solid Plate', domain: 'solid', description: 'Plate with hole (DOLFINx)' },
  { name: 'Heat Transfer', domain: 'thermal', description: 'Steady-state thermal (DOLFINx)' },
  { name: 'Channel Flow', domain: 'fluid', description: '2D channel flow (OpenFOAM)' },
];

export function StartScreen() {
  const isOpen = useAppStore((s) => s.isStartScreenOpen);
  const createProject = useAppStore((s) => s.createProject);
  const loadProject = useAppStore((s) => s.loadProject);
  const setStartScreenOpen = useAppStore((s) => s.setStartScreenOpen);

  if (!isOpen) return null;

  const handleLoadFile = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.fem.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const text = await readFileAsText(file);
      const result = parseProjectFile(text);
      if (result.success && result.data) {
        loadProject(result.data);
      } else {
        alert(result.error ?? 'Failed to load project');
      }
    };
    input.click();
  };

  const handleCreate = (template: typeof TEMPLATES[number]) => {
    createProject(template.name, template.domain);
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ backgroundColor: 'rgba(0,0,0,0.8)' }}
    >
      <div
        className="rounded-lg shadow-2xl max-w-2xl w-full mx-4 overflow-hidden"
        style={{ backgroundColor: 'var(--color-bg-secondary)' }}
      >
        {/* Header */}
        <div className="p-6 text-center border-b" style={{ borderColor: 'var(--color-border)' }}>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-accent)' }}>
            FEM Modeler
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
            FEM/CAE Pre-processing Environment
          </p>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Load existing */}
          <div className="mb-6">
            <button
              onClick={handleLoadFile}
              className="w-full p-4 rounded border text-base text-left transition-colors cursor-pointer"
              style={{
                borderColor: 'var(--color-border)',
                backgroundColor: 'var(--color-bg-input)',
                color: 'var(--color-text)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--color-accent)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--color-border)';
              }}
            >
              Open Existing Project (.fem.json)
            </button>
          </div>

          {/* Templates */}
          <div
            className="text-sm font-bold uppercase tracking-wider mb-3"
            style={{ color: 'var(--color-text-muted)' }}
          >
            New from Template
          </div>
          <div className="grid grid-cols-2 gap-3">
            {TEMPLATES.map((t) => (
              <button
                key={t.name}
                onClick={() => handleCreate(t)}
                className="p-4 rounded border text-left transition-colors cursor-pointer"
                style={{
                  borderColor: 'var(--color-border)',
                  backgroundColor: 'var(--color-bg-input)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--color-accent)';
                  e.currentTarget.style.backgroundColor = 'var(--color-bg-panel)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--color-border)';
                  e.currentTarget.style.backgroundColor = 'var(--color-bg-input)';
                }}
              >
                <div className="text-base font-medium" style={{ color: 'var(--color-text)' }}>
                  {t.name}
                </div>
                <div className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
                  {t.description}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div
          className="px-6 py-3 text-center border-t"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <button
            onClick={() => setStartScreenOpen(false)}
            className="text-sm cursor-pointer"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Skip and use current project
          </button>
        </div>
      </div>
    </div>
  );
}
