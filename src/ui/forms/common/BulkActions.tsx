import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectIR } from '@/core/ir/types';
import { assignmentIssue, planAssignments, planDuplicate, type AssignmentKind, type BatchChange, type DuplicateKind } from '@/core/ir/model-batch';
import { useAppStore } from '@/state/store';

const buttonClass = 'rounded px-2 py-1 text-xs cursor-pointer disabled:opacity-50';
const boxStyle = { border: '1px solid var(--color-border)' };

function UndoNotice({ notice, clear }: { notice: { message: string; snapshot: ProjectIR } | null; clear: () => void }) {
  const { t } = useTranslation();
  const ir = useAppStore((state) => state.ir);
  return notice && <div role="status" aria-live="polite" className="text-xs space-y-1">
    <p>{notice.message}</p>
    <button type="button" className={buttonClass} disabled={ir !== notice.snapshot} onClick={() => { useAppStore.getState().undo(); clear(); }}>{t('bulk.undo')}</button>
  </div>;
}

function useBatchCommit() {
  const [notice, setNotice] = useState<{ message: string; snapshot: ProjectIR } | null>(null);
  return {
    notice, clear: () => setNotice(null),
    commit: (plan: BatchChange, label: string) => {
      useAppStore.getState().mutateIR(label, (draft) => Object.assign(draft, plan.patch));
      setNotice({ message: label, snapshot: useAppStore.getState().ir });
    },
  };
}

export function DuplicateAction({ kind, itemId, onDuplicated }: { kind: DuplicateKind; itemId: string; onDuplicated: (id: string) => void }) {
  const { t } = useTranslation();
  const batch = useBatchCommit();
  const [error, setError] = useState('');
  return <div className="space-y-1">
    <button type="button" className={buttonClass} style={boxStyle} onClick={() => {
      try {
        const plan = planDuplicate(useAppStore.getState().ir, kind, itemId, t('bulk.copySuffix'));
        batch.commit(plan, t('bulk.duplicated', { name: plan.name }));
        setError('');
        onDuplicated(plan.createdId);
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'bulk.failed'); }
    }}>{t('bulk.duplicate')}</button>
    <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{t('bulk.assignmentCopyHint')}</p>
    {error && <p role="alert">{t(error)}</p>}
    <UndoNotice notice={batch.notice} clear={batch.clear} />
  </div>;
}

export function BatchAssignmentAction({ kind, itemId }: { kind: AssignmentKind; itemId: string }) {
  const { t } = useTranslation();
  const ir = useAppStore((state) => state.ir);
  const [ids, setIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<{ snapshot: ProjectIR; plan: BatchChange; lines: string[] } | null>(null);
  const [error, setError] = useState('');
  const batch = useBatchCommit();
  const items = kind === 'material' ? ir.materials : ir.sections;
  const item = items.find((entry) => entry.id === itemId);
  const previousId = (id: string) => kind === 'material'
    ? ir.material_assignments.find((entry) => entry.target_named_selection_id === id)?.material_id
    : ir.section_assignments.find((entry) => entry.target_named_selection_id === id)?.section_id;
  const targets = ir.named_selections.filter((selection) => !assignmentIssue(ir, selection, kind, itemId) && previousId(selection.id) !== itemId);
  return <details className="p-2 rounded space-y-2" style={boxStyle}>
    <summary className="text-xs cursor-pointer">{t('bulk.assignMany')}</summary>
    {targets.map((target) => <label key={target.id} className="flex gap-2 text-xs">
      <input type="checkbox" checked={ids.includes(target.id)} onChange={(event) => { setIds(event.target.checked ? [...ids, target.id] : ids.filter((id) => id !== target.id)); setPreview(null); }} />
      {target.display_name ?? target.name} ({target.id})
    </label>)}
    {!targets.length && <p className="text-xs">{t('assignments.noCompatible')}</p>}
    <button type="button" className={buttonClass} disabled={!ids.length} onClick={() => {
      try {
        const plan = planAssignments(ir, kind, itemId, ids);
        const lines = ids.map((id) => {
          const target = ir.named_selections.find((entry) => entry.id === id)!;
          return `${target.display_name ?? target.name}: ${items.find((entry) => entry.id === previousId(id))?.name ?? '—'} → ${item?.name}`;
        });
        setPreview({ snapshot: ir, plan, lines }); setError('');
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'bulk.failed'); }
    }}>{t('bulk.preview')}</button>
    {preview && <div className="text-xs space-y-1">
      {preview.lines.map((line, index) => <p key={index}>{line}</p>)}
      {preview.snapshot !== ir && <p>{t('bulk.stale')}</p>}
      <button type="button" className={buttonClass} disabled={preview.snapshot !== ir} onClick={() => {
        if (preview.snapshot !== useAppStore.getState().ir) return;
        batch.commit(preview.plan, t('bulk.assigned', { count: preview.lines.length, name: item?.name })); setIds([]); setPreview(null);
      }}>{t('bulk.apply')}</button>
    </div>}
    {error && <p role="alert">{t(error)}</p>}
    <UndoNotice notice={batch.notice} clear={batch.clear} />
  </details>;
}
