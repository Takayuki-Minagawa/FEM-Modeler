import { useTranslation } from 'react-i18next';
import type { ValidationItem } from '@/core/ir/types';

export function DiagnosticMessage({ item }: { item: ValidationItem }) {
  const { t, i18n } = useTranslation();
  const localized = i18n.language === 'ja' && i18n.exists(`diagnosticTitles.${item.code}`);
  return <>
    <span className="font-bold mr-2" style={{ color: `var(--color-${item.severity === 'info' ? 'info' : item.severity})` }}>
      [{t(`diagnosticUi.severity.${item.severity}`)}]
    </span>
    <span>{localized ? t(`diagnosticTitles.${item.code}`) : item.title}</span>
    {localized ? <details className="mt-1 text-xs">
      <summary className="cursor-pointer">{t('diagnosticUi.details')} ({item.code})</summary>
      <p>{item.message}</p>
      {item.suggested_fix && <p>{t('diagnosticUi.fix')}: {item.suggested_fix}</p>}
      {item.target_ref && <p>{t('diagnosticUi.target')}: {item.target_ref}</p>}
    </details> : <><p>{item.message}</p>{item.suggested_fix && <p className="text-xs">{t('diagnosticUi.fix')}: {item.suggested_fix}</p>}</>}
  </>;
}
