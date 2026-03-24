import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/state/store';
import { useAppContext } from '@/hooks/useAppContext';

type TabKey = 'validation' | 'log' | 'export';

export function BottomPanel() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabKey>('validation');
  const validation = useAppStore((s) => s.ir.validation);
  const {
    activityLog,
    clearActivityLog,
    addActivity,
    exportHistory,
    clearExportHistory,
  } = useAppContext();

  const tabs: { key: TabKey; labelKey: string; badge?: number }[] = [
    {
      key: 'validation',
      labelKey: 'bottomPanel.validation',
      badge: validation.summary.error_count + validation.summary.warning_count,
    },
    { key: 'log', labelKey: 'bottomPanel.log', badge: activityLog.length },
    { key: 'export', labelKey: 'bottomPanel.export', badge: exportHistory.length },
  ];

  const handleRunValidation = () => {
    useAppStore.getState().runValidation();
    const nextValidation = useAppStore.getState().ir.validation;
    addActivity(
      nextValidation.summary.error_count > 0 ? 'warning' : 'success',
      nextValidation.summary.error_count > 0
        ? `${t('bottomPanel.validation')}: ${nextValidation.summary.error_count} error(s), ${nextValidation.summary.warning_count} warning(s)`
        : `${t('bottomPanel.validation')}: OK`,
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
            {t(tab.labelKey)}
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
              {t('validation.runValidation')}
            </button>
            {validation.items.length === 0 ? (
              <div
                className="text-sm p-4 text-center"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {t('bottomPanel.noIssues')}
              </div>
            ) : (
              validation.items.map((item) => (
                <div
                  key={item.id}
                  className="text-sm p-3 rounded mb-1.5"
                  style={{ backgroundColor: 'var(--color-bg-input)' }}
                >
                  <span
                    className="font-bold mr-2"
                    style={{
                      color:
                        item.severity === 'error'
                          ? 'var(--color-error)'
                          : item.severity === 'warning'
                            ? 'var(--color-warning)'
                            : 'var(--color-info)',
                    }}
                  >
                    [{item.severity.toUpperCase()}]
                  </span>
                  {item.title}: {item.message}
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
            <div className="flex items-center justify-end mb-2">
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
            {exportHistory.length === 0 ? (
              <div
                className="text-sm p-4 text-center"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {t('bottomPanel.emptyExportHistory')}
              </div>
            ) : (
              exportHistory.map((entry) => (
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
                        {entry.status}
                      </span>
                    </div>
                    <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      {new Date(entry.timestamp).toLocaleTimeString()}
                    </span>
                  </div>

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
