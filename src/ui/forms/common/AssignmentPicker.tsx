import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { NamedSelection, ProjectIR } from '@/core/ir/types';
import { generateId } from '@/core/ir/id-generator';
import { assignmentIssue, type AssignmentKind } from '@/core/ir/model-batch';
import { useAppStore } from '@/state/store';
import { BatchAssignmentAction } from './BulkActions';

/** Shows replacement intent before mutating the store; each assignment is one Undo command. */
export function AssignmentPicker({ kind, itemId }: { kind: AssignmentKind; itemId: string }) {
  const { t } = useTranslation();
  const ir = useAppStore((state) => state.ir);
  const [showIncompatible, setShowIncompatible] = useState(false);
  const [pendingTarget, setPendingTarget] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; snapshot: ProjectIR } | null>(null);
  const items = kind === 'material' ? ir.materials : ir.sections;
  const item = items.find((entry) => entry.id === itemId);
  const assignmentId = (target: string) => kind === 'material'
    ? ir.material_assignments.find((entry) => entry.target_named_selection_id === target)?.material_id
    : ir.section_assignments.find((entry) => entry.target_named_selection_id === target)?.section_id;
  const candidates = ir.named_selections.map((selection) => ({ selection, reason: assignmentIssue(ir, selection, kind, itemId) }))
    .sort((left, right) => Number(Boolean(left.reason)) - Number(Boolean(right.reason)));
  const pending = ir.named_selections.find((selection) => selection.id === pendingTarget);
  const previous = pending ? items.find((entry) => entry.id === assignmentId(pending.id)) : undefined;

  const commit = (selection: NamedSelection) => {
    if (!item || assignmentIssue(ir, selection, kind, itemId)) return;
    const prior = items.find((entry) => entry.id === assignmentId(selection.id));
    const store = useAppStore.getState();
    if (kind === 'material') store.addMaterialAssignment({ id: generateId('material_assignment'), material_id: itemId, target_named_selection_id: selection.id, override_allowed: true });
    else store.addSectionAssignment({ id: generateId('section_assignment'), section_id: itemId, target_named_selection_id: selection.id });
    setNotice({ message: t('assignments.changed', { target: selection.display_name ?? selection.name, before: prior?.name ?? '—', after: item.name }), snapshot: useAppStore.getState().ir });
    setPendingTarget(null);
  };

  return <div className="mt-2 p-2 rounded space-y-2" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
    <p className="text-xs">{t('assignments.compatibleFirst')}</p>
    <BatchAssignmentAction kind={kind} itemId={itemId} />
    <label className="block text-xs"><input type="checkbox" checked={showIncompatible} onChange={(event) => setShowIncompatible(event.target.checked)} /> {t('assignments.showIncompatible')}</label>
    {candidates.length === 0 && <p className="text-xs">{t('common.noSelections')}</p>}
    {candidates.filter((candidate) => showIncompatible || !candidate.reason).map(({ selection, reason }) => {
      const assigned = items.find((entry) => entry.id === assignmentId(selection.id));
      const name = `${selection.display_name ?? selection.name} (${selection.id})`;
      return <div key={selection.id}>
        <button type="button" disabled={Boolean(reason) || assigned?.id === itemId}
          aria-label={t('assignments.assign', { item: item?.name, target: name })}
          onClick={() => assigned ? setPendingTarget(selection.id) : commit(selection)}
          className="w-full text-left px-2 py-1 rounded text-xs cursor-pointer disabled:opacity-50">
          {name} · {selection.target_dimension}D {assigned ? `· ${assigned.name} → ${item?.name}` : ''}
        </button>
        {reason && <p className="px-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>{t(reason)}</p>}
      </div>;
    })}
    {!showIncompatible && candidates.every((candidate) => candidate.reason) && <p className="text-xs">{t('assignments.noCompatible')}</p>}
    {pending && item && <div className="p-2 rounded space-y-2" style={{ border: '1px solid var(--color-warning)' }}>
      <p className="text-xs">{t('assignments.replacePreview', { target: pending.display_name ?? pending.name, before: previous?.name ?? '—', after: item.name })}</p>
      <button type="button" disabled={Boolean(assignmentIssue(ir, pending, kind, itemId))} onClick={() => commit(pending)}>{t('assignments.replace')}</button>
      <button type="button" className="ml-3" onClick={() => setPendingTarget(null)}>{t('common.cancel')}</button>
    </div>}
    {notice && <div role="status" aria-live="polite" className="text-xs space-y-1">
      <p>{notice.message}</p>
      <button type="button" disabled={ir !== notice.snapshot} onClick={() => { useAppStore.getState().undo(); setNotice(null); }}>{t('assignments.undo')}</button>
    </div>}
  </div>;
}
