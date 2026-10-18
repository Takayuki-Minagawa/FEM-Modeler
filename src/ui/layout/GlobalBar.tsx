import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useAppStore } from '@/state/store';
import { useAppContext } from '@/hooks/useAppContext';
import { useProjectFileLoader } from '@/hooks/useProjectFileLoader';
import type { UnitSystemName } from '@/core/ir/types';
import { useViewportWidth } from './useViewportWidth';
import { AsyncOperationStatus } from '@/ui/forms/common/AsyncOperationStatus';

function formatDraftTime(savedAt: string, language: string): string {
  return new Date(savedAt).toLocaleTimeString(language === 'ja' ? 'ja-JP' : 'en-US', { hour: '2-digit', minute: '2-digit' });
}

interface GlobalBarProps {
  treeExpanded?: boolean;
  onToggleTree?: () => void;
  propertiesOpen?: boolean;
  onToggleProperties?: () => void;
}

export function GlobalBar({ treeExpanded, onToggleTree, propertiesOpen, onToggleProperties }: GlobalBarProps = {}) {
  const { t, i18n } = useTranslation();
  const { theme, toggleTheme, openHelp, openImport, saveProjectFile, draftSummary, autosaveState, restoreDraft } = useAppContext();
  const isJa = i18n.language === 'ja';
  const width = useViewportWidth();
  const compact = width < 1600;
  const [loadError, setLoadError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState('');
  const { openFilePicker, operation, cancel, reset } = useProjectFileLoader();
  const projectName = useAppStore((s) => s.ir.meta.project_name);
  const setProjectName = useAppStore((s) => s.setProjectName);
  const unitSystem = useAppStore((s) => s.ir.units.system_name);
  const setUnitSystem = useAppStore((s) => s.setUnitSystem);
  const canUndo = useAppStore((s) => s.canUndo);
  const canRedo = useAppStore((s) => s.canRedo);
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  const setStartScreenOpen = useAppStore((s) => s.setStartScreenOpen);

  const handleLoad = () => {
    setLoadError(null);
    openFilePicker('.json,.fem.json,.fem.zip', (result) => setLoadError(result.success ? null : result.error ?? t('globalBar.loadFailed')));
  };
  const handleRestoreDraft = async () => {
    if (!confirm(t('globalBar.restoreConfirmation'))) return;
    await restoreDraft();
  };
  const toggleLang = () => {
    const next = isJa ? 'en' : 'ja';
    i18n.changeLanguage(next);
    document.documentElement.lang = next;
    localStorage.setItem('fem-modeler-lang', next);
  };
  const commitName = () => {
    if (draftName.trim() && draftName.trim() !== projectName) setProjectName(draftName.trim());
    setRenaming(false);
  };
  const draftStatusLabel = autosaveState.status === 'conflict' ? t('globalBar.draftConflict')
    : autosaveState.status === 'saving' ? t('globalBar.draftSaving')
      : autosaveState.status === 'error' ? t('globalBar.draftError')
        : draftSummary ? t('globalBar.draftSavedAt', { time: formatDraftTime(draftSummary.savedAt, i18n.language) }) : null;
  const draftStatus = draftStatusLabel && <span className="text-xs" title={autosaveState.errorMessage ?? draftSummary?.savedAt ?? undefined}
    style={{ color: autosaveState.status === 'error' || autosaveState.status === 'conflict' ? 'var(--color-error)' : 'var(--color-text-muted)' }}>{draftStatusLabel}</span>;
  const units = <select aria-label={t('globalBar.displayUnits')} value={unitSystem}
    onChange={(event) => setUnitSystem(event.target.value as UnitSystemName)} className="max-w-full text-sm px-2 py-1 rounded"
    style={{ backgroundColor: 'var(--color-bg-input)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
    <option value="SI">SI (m, kg, N, Pa)</option><option value="mm-N-s">mm-N-s (mm, kg, N, MPa)</option><option value="mm-t-s">mm-t-s (mm, t, N, MPa)</option>
  </select>;
  const actions = <div className={`flex items-center gap-1 ${compact ? 'flex-wrap' : ''}`}>
    <BarButton onClick={undo} disabled={!canUndo} title="Ctrl+Z">{t('globalBar.undo')}</BarButton>
    <BarButton onClick={redo} disabled={!canRedo} title="Ctrl+Shift+Z">{t('globalBar.redo')}</BarButton>
    <BarButton onClick={() => saveProjectFile()} title="Ctrl+S">{t('globalBar.save')}</BarButton>
    <BarButton onClick={handleLoad}>{t('globalBar.load')}</BarButton>
    <BarButton onClick={openImport}>{t('globalBar.import')}</BarButton>
    <BarButton onClick={() => setStartScreenOpen(true)}>{t('globalBar.new')}</BarButton>
    <BarButton onClick={openHelp}>{t('globalBar.help')}</BarButton>
    {draftSummary && <BarButton onClick={handleRestoreDraft}>{t('globalBar.restoreDraft')}</BarButton>}
  </div>;

  return <header className="global-bar relative flex items-center justify-between px-2 border-b select-none shrink-0"
    style={{ height: 'var(--global-bar-height)', backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border)' }}>
    {(operation || loadError) && <div className="absolute top-full left-0 right-0 z-40 max-h-64 overflow-y-auto p-3 text-sm shadow-lg" style={{ backgroundColor: 'var(--color-bg-panel)' }}>
      <AsyncOperationStatus operation={operation} onCancel={() => cancel(t('asyncOperation.importCancelled'))} />
      {!operation && loadError && <p role="alert" style={{ color: 'var(--color-error)' }}>{loadError}</p>}
      {operation?.status !== 'running' && <button type="button" className="mt-2 underline" onClick={() => { reset(); setLoadError(null); }}>{t('globalBar.dismiss')}</button>}
    </div>}
    {onToggleTree && <button type="button" aria-label={t('workflow.toggleTree')} aria-expanded={treeExpanded} onClick={onToggleTree} className="p-2 shrink-0">☰</button>}
    <div className="global-bar-project flex items-center gap-3 flex-1">
      {width >= 900 && <span className="font-bold text-base shrink-0" style={{ color: 'var(--color-accent)' }}>{t('app.title')}</span>}
      {renaming ? <input autoFocus aria-label={t('workflow.projectName')} value={draftName} onChange={(event) => setDraftName(event.target.value)} onBlur={commitName}
        onKeyDown={(event) => { if (event.key === 'Enter') commitName(); if (event.key === 'Escape') setRenaming(false); }}
        className="min-w-0 w-48 rounded p-1 text-sm" style={{ backgroundColor: 'var(--color-bg-input)' }} />
        : <button type="button" aria-label={`${t('workflow.renameProject')}: ${projectName}`} title={projectName} onClick={() => { setDraftName(projectName); setRenaming(true); }} className="truncate min-w-0 max-w-56 text-left text-sm">{projectName} ✎</button>}
      {!compact && units}
    </div>
    {!compact && actions}
    <div className="flex items-center gap-2 shrink-0">
      {!compact && draftStatus}
      {onToggleProperties && <button type="button" aria-label={t('workflow.toggleProperties')} aria-expanded={propertiesOpen} onClick={onToggleProperties} className="p-2 text-sm">{t('workflow.properties')}</button>}
      {compact && <details className="global-bar-menu" onKeyDown={(event) => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }}>
        <summary className="cursor-pointer px-2 py-1 text-sm">{t('workflow.moreActions')}</summary>
        <div className="space-y-3">{actions}{units}<div>{draftStatus}</div><span className="text-xs">{t('app.version')}</span></div>
      </details>}
      <button type="button" onClick={toggleTheme} aria-label={theme === 'dark' ? t('theme.light') : t('theme.dark')} className="p-2 text-sm rounded" style={{ backgroundColor: 'var(--color-bg-input)' }}>{theme === 'dark' ? '☀' : '☾'}</button>
      <button type="button" onClick={toggleLang} aria-label={isJa ? 'English' : '日本語'} className="p-2 text-sm font-bold rounded" style={{ backgroundColor: 'var(--color-bg-input)' }}>{isJa ? 'EN' : 'JA'}</button>
    </div>
  </header>;
}

function BarButton({ children, onClick, disabled, title }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; title?: string }) {
  return <button type="button" onClick={onClick} disabled={disabled} title={title} className="px-2 py-1.5 text-sm rounded cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--color-bg-input)]" style={{ color: 'var(--color-text-secondary)' }}>{children}</button>;
}
