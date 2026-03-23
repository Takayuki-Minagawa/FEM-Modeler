import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/state/store';
import { downloadProjectFile } from '@/export/project/save';
import { readFileAsText, parseProjectFile } from '@/export/project/load';
import { useAppContext } from '@/hooks/useAppContext';

export function GlobalBar() {
  const { t, i18n } = useTranslation();
  const { theme, toggleTheme, openHelp } = useAppContext();
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

  const toggleLang = () => {
    const next = i18n.language === 'ja' ? 'en' : 'ja';
    i18n.changeLanguage(next);
    localStorage.setItem('fem-modeler-lang', next);
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
          {t('app.title')}
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
        <BarButton onClick={undo} disabled={!canUndo} title="Ctrl+Z">
          {t('globalBar.undo')}
        </BarButton>
        <BarButton onClick={redo} disabled={!canRedo} title="Ctrl+Shift+Z">
          {t('globalBar.redo')}
        </BarButton>
        <BarDivider />
        <BarButton onClick={handleSave} title="Ctrl+S">
          {t('globalBar.save')}
        </BarButton>
        <BarButton onClick={handleLoad}>
          {t('globalBar.load')}
        </BarButton>
        <BarButton onClick={() => setStartScreenOpen(true)}>
          {t('globalBar.new')}
        </BarButton>
        <BarDivider />
        <BarButton onClick={openHelp}>
          {t('globalBar.help')}
        </BarButton>
      </div>

      {/* Right: theme, lang, version */}
      <div className="flex items-center gap-2">
        <button
          onClick={toggleTheme}
          className="px-2 py-1 text-sm rounded cursor-pointer transition-colors"
          style={{
            backgroundColor: 'var(--color-bg-input)',
            color: 'var(--color-text-secondary)',
          }}
          title={theme === 'dark' ? t('theme.light') : t('theme.dark')}
        >
          {theme === 'dark' ? '\u2600' : '\u263E'}
        </button>

        <button
          onClick={toggleLang}
          className="px-2 py-1 text-sm rounded cursor-pointer transition-colors font-bold"
          style={{
            backgroundColor: 'var(--color-bg-input)',
            color: 'var(--color-text-secondary)',
          }}
          title={i18n.language === 'ja' ? 'English' : '\u65E5\u672C\u8A9E'}
        >
          {i18n.language === 'ja' ? 'EN' : 'JA'}
        </button>

        <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          {t('app.version')}
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

function BarDivider() {
  return (
    <div
      className="w-px h-6 mx-1.5"
      style={{ backgroundColor: 'var(--color-border)' }}
    />
  );
}
