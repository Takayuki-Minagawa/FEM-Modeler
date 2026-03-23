import { useAppStore } from '@/state/store';
import { downloadProjectFile } from '@/export/project/save';
import { readFileAsText } from '@/export/project/load';
import { parseProjectFile } from '@/export/project/load';

export function GlobalBar() {
  const projectName = useAppStore((s) => s.ir.meta.project_name);
  const unitSystem = useAppStore((s) => s.ir.units.system_name);
  const canUndo = useAppStore((s) => s.canUndo);
  const canRedo = useAppStore((s) => s.canRedo);
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  const ir = useAppStore((s) => s.ir);
  const loadProject = useAppStore((s) => s.loadProject);
  const setStartScreenOpen = useAppStore((s) => s.setStartScreenOpen);

  const handleSave = () => {
    downloadProjectFile(ir);
  };

  const handleLoad = async () => {
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

  return (
    <div
      className="flex items-center justify-between px-4 border-b select-none shrink-0"
      style={{
        height: 'var(--global-bar-height)',
        backgroundColor: 'var(--color-bg-secondary)',
        borderColor: 'var(--color-border)',
      }}
    >
      {/* Left: project info */}
      <div className="flex items-center gap-4">
        <span className="font-bold text-base" style={{ color: 'var(--color-accent)' }}>
          FEM Modeler
        </span>
        <span className="text-base" style={{ color: 'var(--color-text-secondary)' }}>
          {projectName}
        </span>
        <span
          className="text-sm px-2 py-0.5 rounded"
          style={{
            backgroundColor: 'var(--color-bg-input)',
            color: 'var(--color-text-muted)',
          }}
        >
          {unitSystem}
        </span>
      </div>

      {/* Center: actions */}
      <div className="flex items-center gap-1.5">
        <BarButton onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
          Undo
        </BarButton>
        <BarButton onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
          Redo
        </BarButton>
        <div className="w-px h-6 mx-1.5" style={{ backgroundColor: 'var(--color-border)' }} />
        <BarButton onClick={handleSave} title="Save project">
          Save
        </BarButton>
        <BarButton onClick={handleLoad} title="Load project">
          Load
        </BarButton>
        <BarButton onClick={() => setStartScreenOpen(true)} title="New project">
          New
        </BarButton>
      </div>

      {/* Right: placeholder */}
      <div className="flex items-center gap-2">
        <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          v0.1.0
        </span>
      </div>
    </div>
  );
}

function BarButton({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="px-3 py-1.5 text-sm rounded transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
      style={{
        backgroundColor: 'transparent',
        color: 'var(--color-text-secondary)',
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.backgroundColor = 'var(--color-bg-input)';
          e.currentTarget.style.color = 'var(--color-text)';
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'transparent';
        e.currentTarget.style.color = 'var(--color-text-secondary)';
      }}
    >
      {children}
    </button>
  );
}
