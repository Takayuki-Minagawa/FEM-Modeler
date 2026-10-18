import { useTranslation } from 'react-i18next';
import type { ProjectIR, ValidationItem } from '@/core/ir/types';
import { modelValidationRunStatus } from '@/modeling/validation';
import { modelIssueCopy, modelIssuesEn, modelValidationCopy, type ModelIssueCode } from '@/modeling/validation-copy';
import { modelDiagnosticTarget } from '@/modeling/navigation';
import { openDiagnosticTarget } from './openDiagnosticTarget';

export function ModelValidationSummary({ ir }: { ir: ProjectIR }) {
  const { i18n } = useTranslation();
  const copy = modelValidationCopy(i18n.language);
  const status = modelValidationRunStatus(ir);
  const { last_run_at, validated_revision, model_revision, summary } = ir.validation;
  const color = status === 'current' ? (summary.error_count ? 'var(--color-error)' : 'var(--color-success)') : 'var(--color-warning)';
  return <section className="p-3 rounded space-y-1 text-xs" aria-live="polite" style={{ backgroundColor: 'var(--color-bg-input)' }}>
    <p className="font-bold text-sm" style={{ color }}>{copy[status]}</p>
    <p>{copy.scope}</p>
    {status === 'not_run' && last_run_at && <p>{copy.legacy}</p>}
    {status !== 'not_run' && <>
      <p>{copy.revision(validated_revision, model_revision)}</p>
      <time dateTime={last_run_at}>{new Date(last_run_at).toLocaleString(i18n.language.startsWith('ja') ? 'ja-JP' : 'en-US')}</time>
      <p>{copy.counts(summary.error_count, summary.warning_count)}</p>
      {status === 'current' && summary.error_count === 0 && summary.warning_count === 0 && <p>{copy.clear}</p>}
    </>}
  </section>;
}

export function ModelDiagnosticMessage({ ir, item }: { ir: ProjectIR; item: ValidationItem }) {
  const { i18n } = useTranslation();
  const copy = modelValidationCopy(i18n.language);
  const code = item.code as ModelIssueCode;
  const wording = modelIssueCopy(i18n.language)[code];
  const original = modelIssuesEn[code];
  const detail = original && item.message.startsWith(original[1]) ? item.message.slice(original[1].length) : '';
  const target = modelDiagnosticTarget(ir, item.target_ref);
  return <>
    <span className="font-bold mr-2" style={{ color: `var(--color-${item.severity})` }}>[{copy.severity[item.severity]}]</span>
    <span>{wording?.[0] ?? item.title}</span>
    <p>{wording ? `${wording[1]}${detail}` : item.message}</p>
    <p className="text-xs">{copy.fix}: {wording?.[2] ?? item.suggested_fix}</p>
    {item.target_ref && <p className="text-xs">{copy.target}: {target?.name ?? item.target_ref}</p>}
    {target && <button type="button" className="block mt-2 text-xs underline" onClick={() => openDiagnosticTarget(target)}>{copy.open(target.name)}</button>}
  </>;
}
