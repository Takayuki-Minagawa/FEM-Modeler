import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/state/store';
import { useAppContext } from '@/hooks/useAppContext';
import { useProjectFileLoader } from '@/hooks/useProjectFileLoader';

function formatDraftTime(savedAt: string, language: string): string {
  const locale = language === 'ja' ? 'ja-JP' : 'en-US';
  return new Date(savedAt).toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function GlobalBar() {
  const { t, i18n } = useTranslation();
  const {
    theme,
    toggleTheme,
    openHelp,
    openImport,
    saveProjectFile,
    draftSummary,
    autosaveState,
    restoreDraft,
  } = useAppContext();
  const isJa = i18n.language === 'ja';
  const { openFilePicker } = useProjectFileLoader();
  const projectName = useAppStore((s) => s.ir.meta.project_name);
  const unitSystem = useAppStore((s) => s.ir.units.system_name);
  const canUndo = useAppStore((s) => s.canUndo);
  const canRedo = useAppStore((s) => s.canRedo);
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  const setStartScreenOpen = useAppStore((s) => s.setStartScreenOpen);

  const handleSave = () => {
    saveProjectFile();
  };

  const handleLoad = () => {
    openFilePicker('.json,.fem.json');
  };

  const handleRestoreDraft = async () => {
    const confirmed = confirm(
      isJa
        ? '現在のプロジェクトを置き換えて、自動保存された草稿を復元しますか？'
        : 'Replace the current project with the auto-saved draft?',
    );
    if (!confirmed) return;
    await restoreDraft();
  };

  const toggleLang = () => {
    const next = i18n.language === 'ja' ? 'en' : 'ja';
    i18n.changeLanguage(next);
    localStorage.setItem('fem-modeler-lang', next);
  };

  const draftStatusLabel =
    autosaveState.status === 'saving'
      ? t('globalBar.draftSaving')
      : autosaveState.status === 'error'
        ? t('globalBar.draftError')
        : draftSummary
          ? t('globalBar.draftSavedAt', { time: formatDraftTime(draftSummary.savedAt, i18n.language) })
          : null;

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
        <BarButton onClick={openImport}>
          {isJa ? 'インポート' : 'Import'}
        </BarButton>
        <BarButton onClick={() => setStartScreenOpen(true)}>
          {t('globalBar.new')}
        </BarButton>
        <BarDivider />
        <BarButton onClick={openHelp}>
          {t('globalBar.help')}
        </BarButton>
        {draftSummary && (
          <BarButton onClick={handleRestoreDraft}>
            {t('globalBar.restoreDraft')}
          </BarButton>
        )}
      </div>

      {/* Right: theme, lang, version */}
      <div className="flex items-center gap-2">
        {draftStatusLabel && (
          <span
            className="px-2 py-1 text-xs rounded"
            title={autosaveState.errorMessage ?? draftSummary?.savedAt ?? undefined}
            style={{
              backgroundColor:
                autosaveState.status === 'error'
                  ? 'rgba(244,67,54,0.12)'
                  : autosaveState.status === 'saving'
                    ? 'rgba(74,144,217,0.12)'
                    : 'var(--color-bg-input)',
              color:
                autosaveState.status === 'error'
                  ? 'var(--color-error)'
                  : autosaveState.status === 'saving'
                    ? 'var(--color-accent)'
                    : 'var(--color-text-muted)',
            }}
          >
            {draftStatusLabel}
          </span>
        )}

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
