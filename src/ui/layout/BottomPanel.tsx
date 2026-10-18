import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/state/store';
import { useAppContext } from '@/hooks/useAppContext';
import { ModelDiagnosticMessage, ModelValidationSummary } from '@/ui/forms/common/ModelValidationSummary';
import { modelValidationCopy } from '@/modeling/validation-copy';

type TabKey = 'validation' | 'log' | 'export';

export function BottomPanel() {
  const { t, i18n } = useTranslation();
  const copy = modelValidationCopy(i18n.language);
  const [activeTab, setActiveTab] = useState<TabKey>('validation');
  const ir = useAppStore((s) => s.ir);
  const validation = ir.validation;
  const modelChecks = validation.model_context?.kind === 'model';
  const [historyScope, setHistoryScope] = useState<'current' | 'all'>('current');
  const {
    activityLog,
    clearActivityLog,
    addActivity,
    exportHistory,
    clearExportHistory,
  } = useAppContext();
  const visibleHistory = exportHistory.filter(entry => ['JSON', 'Bundle', 'STEP', 'IGES'].includes(entry.target) && (historyScope === 'all' || entry.projectId === ir.meta.project_id));

  const tabs: { key: TabKey; label: string; badge?: number }[] = [
    {
      key: 'validation',
      label: copy.tab,
      badge: modelChecks ? validation.summary.error_count + validation.summary.warning_count : undefined,
    },
    { key: 'log', label: copy.log, badge: activityLog.length },
    { key: 'export', label: copy.history, badge: visibleHistory.length },
  ];

  const handleRunValidation = () => {
    useAppStore.getState().runModelValidation();
    const nextValidation = useAppStore.getState().ir.validation;
    addActivity(
      nextValidation.summary.error_count > 0 ? 'warning' : 'success',
      nextValidation.summary.error_count > 0
        ? `${copy.tab}: ${copy.counts(nextValidation.summary.error_count, nextValidation.summary.warning_count)}`
        : `${copy.tab}: OK`,
    );
  };

  return (
    <div
      className="h-full flex flex-col"
      style={{ backgroundColor: 'var(--color-bg-secondary)' }}
    >
      {/* Tab bar */}
      <div
        className="flex border-b shrink-0"
        style={{ borderColor: 'var(--color-border)' }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className="px-4 py-2 text-sm transition-colors relative cursor-pointer"
            style={{
              color:
                activeTab === tab.key
                  ? 'var(--color-text)'
                  : 'var(--color-text-muted)',
              borderBottom:
                activeTab === tab.key
                  ? '2px solid var(--color-accent)'
                  : '2px solid transparent',
            }}
          >
            {tab.label}
            {tab.badge != null && tab.badge > 0 && (
              <span
                className="ml-1.5 px-1.5 py-0.5 rounded-full"
                style={{
                  backgroundColor: 'var(--color-error)',
                  color: '#fff',
                  fontSize: '12px',
                }}
              >
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-3">
        {activeTab === 'validation' && (
          <div>
            <button
              onClick={handleRunValidation}
              className="mb-2 px-3 py-1.5 rounded text-sm cursor-pointer"
              style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}
            >
              {copy.run}
            </button>
            <ModelValidationSummary ir={ir} />
            {modelChecks && validation.items.length > 0 && (
              validation.items.map((item) => (
                <div
                  key={item.id}
                  className="text-sm p-3 rounded mb-1.5"
                  style={{ backgroundColor: 'var(--color-bg-input)' }}
                >
                  <ModelDiagnosticMessage ir={ir} item={item} />
                </div>
              ))
            )}
          </div>
        )}
        {activeTab === 'log' && (
          <div>
            <div className="flex items-center justify-end mb-2">
              <button
                onClick={clearActivityLog}
                className="px-3 py-1.5 rounded text-sm cursor-pointer"
                style={{
                  backgroundColor: 'var(--color-bg-input)',
                  color: 'var(--color-text-secondary)',
                }}
              >
                {t('bottomPanel.clearLog')}
              </button>
            </div>
            {activityLog.length === 0 ? (
              <div
                className="text-sm p-4 text-center"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {t('bottomPanel.emptyLog')}
              </div>
            ) : (
              activityLog.map((entry) => (
                <div
                  key={entry.id}
                  className="mb-1.5 p-3 rounded text-sm"
                  style={{ backgroundColor: 'var(--color-bg-input)' }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span
                      className="font-bold uppercase text-xs"
                      style={{
                        color:
                          entry.level === 'error'
                            ? 'var(--color-error)'
                            : entry.level === 'warning'
                              ? 'var(--color-warning)'
                              : entry.level === 'success'
                                ? 'var(--color-success)'
                                : 'var(--color-accent)',
                      }}
                    >
                      {entry.level}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      {new Date(entry.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="mt-1" style={{ color: 'var(--color-text)' }}>
                    {entry.message}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
        {activeTab === 'export' && (
          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <select aria-label={t('review.history.filter')} value={historyScope} onChange={event => setHistoryScope(event.target.value as 'current' | 'all')} className="min-w-0 text-xs px-2 py-1 rounded" style={{ backgroundColor: 'var(--color-bg-input)' }}>
                <option value="current">{t('review.history.current')}</option>
                <option value="all">{t('review.history.all')}</option>
              </select>
              <button
                onClick={clearExportHistory}
                className="px-3 py-1.5 rounded text-sm cursor-pointer"
                style={{
                  backgroundColor: 'var(--color-bg-input)',
                  color: 'var(--color-text-secondary)',
                }}
              >
                {t('bottomPanel.clearExportHistory')}
              </button>
            </div>
            <p className="text-xs mb-2" style={{ color: 'var(--color-text-muted)' }}>{t('review.history.generatedOnly')}</p>
            {visibleHistory.length === 0 ? (
              <div
                className="text-sm p-4 text-center"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {t('bottomPanel.emptyExportHistory')}
              </div>
            ) : (
              visibleHistory.map((entry) => (
                <div
                  key={entry.id}
                  className="mb-2 p-3 rounded text-sm"
                  style={{ backgroundColor: 'var(--color-bg-input)' }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span
                        className="font-bold"
                        style={{
                          color:
                            entry.status === 'error'
                              ? 'var(--color-error)'
                              : entry.status === 'warning'
                                ? 'var(--color-warning)'
                                : 'var(--color-success)',
                        }}
                      >
                        {entry.target}
                      </span>
                      <span
                        className="text-xs uppercase"
                        style={{
                          color:
                            entry.status === 'error'
                              ? 'var(--color-error)'
                              : entry.status === 'warning'
                                ? 'var(--color-warning)'
                                : 'var(--color-success)',
                        }}
                      >
                        {t(`review.history.${entry.status}`)}
                      </span>
                    </div>
                    <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      {new Date(entry.timestamp).toLocaleTimeString()}
                    </span>
                  </div>

                  <dl className="text-xs mt-2 space-y-1 break-all">
                    <div><dt className="inline">{t('review.history.project')}: </dt><dd className="inline">{entry.projectName} ({entry.projectId})</dd></div>
                    <div><dt className="inline">{t('review.history.revision')}: </dt><dd className="inline">{entry.revision}</dd></div>
                    {entry.fileName && <div><dt className="inline">{t('review.history.file')}: </dt><dd className="inline">{entry.fileName}</dd></div>}
                    {entry.status !== 'error' && <div><dt className="inline">{t('review.history.bytes')}: </dt><dd className="inline">{entry.bytes == null ? t('review.history.unknownSize') : `${entry.bytes.toLocaleString()} B`}</dd></div>}
                    {entry.operationId && <div>{t('review.export.operation', { id: entry.operationId })}</div>}
                  </dl>

                  <div className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {entry.errorCount > 0
                      ? `${entry.errorCount} error(s)`
                      : entry.warningCount > 0
                        ? `${entry.warningCount} warning(s)`
                        : t('bottomPanel.exportOk')}
                  </div>

                  {entry.errors.map((error, index) => (
                    <div
                      key={`${entry.id}-error-${index}`}
                      className="mt-1 text-xs"
                      style={{ color: 'var(--color-error)' }}
                    >
                      {error}
                    </div>
                  ))}
                  {entry.warnings.map((warning, index) => (
                    <div
                      key={`${entry.id}-warning-${index}`}
                      className="mt-1 text-xs"
                      style={{ color: 'var(--color-warning)' }}
                    >
                      {warning}
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
