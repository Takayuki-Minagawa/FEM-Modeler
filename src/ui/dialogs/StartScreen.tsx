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
  { i18nKey: 'truss3d', domain: 'truss' },
  { i18nKey: 'solidPlate', domain: 'solid' },
  { i18nKey: 'heat', domain: 'thermal' },
  { i18nKey: 'channel', domain: 'fluid' },
];

export function StartScreen() {
  const { t, i18n } = useTranslation();
  const { draftSummary, restoreDraft, discardDraft, addActivity } = useAppContext();
  const { openFilePicker } = useProjectFileLoader();
  const isOpen = useAppStore((s) => s.isStartScreenOpen);
  const createProject = useAppStore((s) => s.createProject);
  const setStartScreenOpen = useAppStore((s) => s.setStartScreenOpen);

  if (!isOpen) return null;

  const handleLoadFile = () => {
    openFilePicker('.json,.fem.json');
  };

  const handleCreate = (tmpl: typeof TEMPLATES[number]) => {
    const name = t(`startScreen.templates.${tmpl.i18nKey}.name`);
    createProject(name, tmpl.domain);
    if (tmpl.i18nKey !== 'empty') {
      applyTemplate(tmpl.domain, i18n.language);
    }
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
        ? '自動保存された草稿を破棄しますか？'
        : 'Discard the auto-saved draft?',
    );
    if (!confirmed) return;
    await discardDraft();
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
            {t('app.title')}
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
            {t('startScreen.subtitle')}
          </p>
        </div>

        {/* Content */}
        <div className="p-6">
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
                onClick={() => handleCreate(tmpl)}
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
                  {t(`startScreen.templates.${tmpl.i18nKey}.name`)}
                </div>
                <div className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
                  {t(`startScreen.templates.${tmpl.i18nKey}.desc`)}
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
      </div>
    </div>
  );
}
