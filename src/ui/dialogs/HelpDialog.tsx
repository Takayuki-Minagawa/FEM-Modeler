import { useTranslation } from 'react-i18next';

interface HelpDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function HelpDialog({ isOpen, onClose }: HelpDialogProps) {
  const { t } = useTranslation();

  if (!isOpen) return null;

  const sections = [
    {
      key: 'overview',
      title: t('help.sections.overview.title'),
      content: <p>{t('help.sections.overview.content')}</p>,
    },
    {
      key: 'workflow',
      title: t('help.sections.workflow.title'),
      content: (
        <ul className="space-y-1">
          {(t('help.sections.workflow.steps', { returnObjects: true }) as string[]).map(
            (step, i) => (
              <li key={i}>{step}</li>
            ),
          )}
        </ul>
      ),
    },
    {
      key: 'viewer',
      title: t('help.sections.viewer.title'),
      content: (
        <ul className="space-y-1">
          {(t('help.sections.viewer.items', { returnObjects: true }) as string[]).map(
            (item, i) => (
              <li key={i}>{item}</li>
            ),
          )}
        </ul>
      ),
    },
    {
      key: 'shortcuts',
      title: t('help.sections.shortcuts.title'),
      content: (
        <ul className="space-y-1">
          {(t('help.sections.shortcuts.items', { returnObjects: true }) as string[]).map(
            (item, i) => (
              <li key={i} className="font-mono text-sm">
                {item}
              </li>
            ),
          )}
        </ul>
      ),
    },
    {
      key: 'panels',
      title: t('help.sections.panels.title'),
      content: (
        <ul className="space-y-1">
          {(t('help.sections.panels.items', { returnObjects: true }) as string[]).map(
            (item, i) => (
              <li key={i}>{item}</li>
            ),
          )}
        </ul>
      ),
    },
    {
      key: 'solvers',
      title: t('help.sections.solvers.title'),
      content: (
        <ul className="space-y-1">
          {(t('help.sections.solvers.items', { returnObjects: true }) as string[]).map(
            (item, i) => (
              <li key={i}>{item}</li>
            ),
          )}
        </ul>
      ),
    },
  ];

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="rounded-lg shadow-2xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col"
        style={{ backgroundColor: 'var(--color-bg-secondary)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b shrink-0"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <h2 className="text-lg font-bold" style={{ color: 'var(--color-accent)' }}>
            {t('help.title')}
          </h2>
          <button
            onClick={onClose}
            className="px-3 py-1 text-sm rounded cursor-pointer transition-colors"
            style={{
              backgroundColor: 'var(--color-bg-input)',
              color: 'var(--color-text-secondary)',
            }}
          >
            {t('help.close')}
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {sections.map((section) => (
            <div key={section.key}>
              <h3
                className="text-base font-bold mb-2"
                style={{ color: 'var(--color-text)' }}
              >
                {section.title}
              </h3>
              <div
                className="text-sm leading-relaxed pl-2"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {section.content}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
