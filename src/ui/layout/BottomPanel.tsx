import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/state/store';

type TabKey = 'validation' | 'log' | 'export';

export function BottomPanel() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabKey>('validation');
  const validation = useAppStore((s) => s.ir.validation);

  const tabs: { key: TabKey; labelKey: string; badge?: number }[] = [
    {
      key: 'validation',
      labelKey: 'bottomPanel.validation',
      badge: validation.summary.error_count + validation.summary.warning_count,
    },
    { key: 'log', labelKey: 'bottomPanel.log' },
    { key: 'export', labelKey: 'bottomPanel.export' },
  ];

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
              onClick={() => useAppStore.getState().runValidation()}
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
          <div
            className="text-sm p-4 text-center"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {t('bottomPanel.logPlaceholder')}
          </div>
        )}
        {activeTab === 'export' && (
          <div
            className="text-sm p-4 text-center"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {t('bottomPanel.exportPlaceholder')}
          </div>
        )}
      </div>
    </div>
  );
}
