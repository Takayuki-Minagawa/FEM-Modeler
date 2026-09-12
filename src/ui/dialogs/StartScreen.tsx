import { RecentProjects } from './RecentProjects';
import { useState } from 'react';
import { Modal } from './Modal';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/state/store';
import { applyTemplate } from '@/lib/project-templates';
import type { DomainType } from '@/core/ir/types';
import { useAppContext } from '@/hooks/useAppContext';
import { useProjectFileLoader } from '@/hooks/useProjectFileLoader';

function formatDraftDate(savedAt: string, language: string): string {
  const locale = language === 'ja' ? 'ja-JP' : 'en-US';
  return new Date(savedAt).toLocaleString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const TEMPLATES: { i18nKey: string; domain: DomainType }[] = [
  { i18nKey: 'empty', domain: 'frame' },
  { i18nKey: 'frame2d', domain: 'frame' },
  { i18nKey: 'truss2d', domain: 'truss' },
  { i18nKey: 'solidPlate', domain: 'solid' },
  { i18nKey: 'heat', domain: 'thermal' },
  { i18nKey: 'channel', domain: 'fluid' },
];

export function StartScreen() {
  const { t, i18n } = useTranslation();
  const { draftSummary, restoreDraft, discardDraft, addActivity, transitionProject, saveProjectFile, autosaveState } = useAppContext();
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const { openFilePicker } = useProjectFileLoader();
  const isOpen = useAppStore((s) => s.isStartScreenOpen);
  const createProject = useAppStore((s) => s.createProject);
  const setStartScreenOpen = useAppStore((s) => s.setStartScreenOpen);

  if (!isOpen) return null;

  const templateText = (
    template: typeof TEMPLATES[number],
    field: 'name' | 'desc',
  ): string => t(`startScreen.templates.${template.i18nKey}.${field}`);

  const handleLoadFile = () => {
    setTransitionError(null);
    openFilePicker('.json,.fem.json,.fem.zip', (result) => setTransitionError(result.success ? null : result.error ?? 'Failed to load project.'));
  };

  const handleCreate = async (tmpl: typeof TEMPLATES[number]) => {
    setTransitionError(null); setTransitioning(true);
    const name = templateText(tmpl, 'name');
    const result = await transitionProject(() => {
      createProject(name, tmpl.domain);
      if (tmpl.i18nKey !== 'empty') applyTemplate(tmpl.domain, i18n.language);
    });
    setTransitioning(false);
    if (!result.success) { setTransitionError(result.error ?? 'Project switch cancelled.'); return; }
    addActivity(
      'info',
      i18n.language === 'ja'
        ? `テンプレート "${name}" から新規プロジェクトを作成しました。`
        : `Created a new project from the "${name}" template.`,
    );
  };

  const handleDiscardDraft = async () => {
    const confirmed = confirm(
      i18n.language === 'ja'
        ? '自動保存データを破棄しますか？'
        : 'Discard the auto-saved draft?',
    );
    if (!confirmed) return;
    await discardDraft();
  };

  return (
    <Modal isOpen={isOpen} onClose={() => setStartScreenOpen(false)} labelledBy="start-dialog-title" dismissOnBackdrop={false}>
        {/* Header */}
        <div className="p-6 text-center border-b" style={{ borderColor: 'var(--color-border)' }}>
          <h1 id="start-dialog-title" className="text-2xl font-bold" style={{ color: 'var(--color-accent)' }}>
            {t('app.title')}
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
            {t('startScreen.subtitle')}
          </p>
          <button type="button" className="mt-2 text-sm underline cursor-pointer" aria-label={i18n.language === 'ja' ? 'Switch to English' : '日本語に切り替え'} onClick={() => {
            const next = i18n.language === 'ja' ? 'en' : 'ja';
            void i18n.changeLanguage(next); document.documentElement.lang = next; localStorage.setItem('fem-modeler-lang', next);
          }}>{i18n.language === 'ja' ? 'English' : '日本語'}</button>
        </div>

        {/* Content */}
        <div className="p-6">
          {(transitionError || autosaveState.status === 'error' || autosaveState.status === 'conflict') && <div className="mb-4 text-sm" style={{ color: 'var(--color-error)' }}>
            <p role="alert">{transitionError ?? autosaveState.errorMessage}</p>
            <button type="button" className="mt-2 underline" onClick={saveProjectFile}>{i18n.language === 'ja' ? '現在のプロジェクトをファイルに保存' : 'Save current project to a file'}</button>
          </div>}
          {draftSummary && (
            <div
              className="mb-6 p-4 rounded border"
              style={{
                borderColor: 'var(--color-accent)',
                backgroundColor: 'rgba(74,144,217,0.08)',
              }}
            >
              <div className="text-sm font-bold" style={{ color: 'var(--color-accent)' }}>
                {t('startScreen.recoveryTitle')}
              </div>
              <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                {t('startScreen.recoveryDescription')}
              </p>
              <div className="text-xs mt-3" style={{ color: 'var(--color-text-muted)' }}>
                {draftSummary.projectName} · {t('startScreen.draftSavedAt')}: {formatDraftDate(draftSummary.savedAt, i18n.language)}
              </div>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => void restoreDraft()}
                  className="px-4 py-2 rounded text-sm font-medium cursor-pointer"
                  style={{
                    backgroundColor: 'var(--color-accent)',
                    color: '#fff',
                  }}
                >
                  {t('startScreen.restoreDraft')}
                </button>
                <button
                  onClick={() => void handleDiscardDraft()}
                  className="px-4 py-2 rounded text-sm cursor-pointer"
                  style={{
                    backgroundColor: 'var(--color-bg-input)',
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  {t('startScreen.discardDraft')}
                </button>
              </div>
            </div>
          )}

          <RecentProjects />

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
              {t('startScreen.openExisting')}
            </button>
          </div>

          {/* Templates */}
          <div
            className="text-sm font-bold uppercase tracking-wider mb-3"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {t('startScreen.newFromTemplate')}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {TEMPLATES.map((tmpl) => (
              <button
                key={tmpl.i18nKey}
                onClick={() => void handleCreate(tmpl)}
                disabled={transitioning}
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
                  {templateText(tmpl, 'name')}
                </div>
                <div className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
                  {templateText(tmpl, 'desc')}
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
            {t('startScreen.skip')}
          </button>
        </div>
    </Modal>
  );
}
