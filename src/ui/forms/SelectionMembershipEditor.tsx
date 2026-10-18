import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { NamedSelection, ProjectIR } from '@/core/ir/types';
import type { NamedSelectionQuery, SelectionOperation, SelectionPredicate } from '@/core/selections/types';
import { editableEntityType, previewSelectionEdit, type SelectionEditPreview } from '@/core/selections/query';
import { useAppStore } from '@/state/store';
import { FormField } from './common/FormField';
import { parseFiniteNumber } from './common/numeric';
import { NumericDraftInput } from './common/NumericField';

interface Preview { result: SelectionEditPreview; query: NamedSelectionQuery; ir: ProjectIR; inputKey: string }
export function SelectionMembershipEditor({ selection, onClose }: { selection: NamedSelection; onClose: () => void }) {
  const { t } = useTranslation();
  const ir = useAppStore((state) => state.ir);
  const selected = useAppStore((state) => state.selectedEntityIds);
  const [operation, setOperation] = useState<SelectionOperation>('add');
  const [source, setSource] = useState<'ids' | 'coordinate_range' | 'face_normal'>('ids');
  const [axis, setAxis] = useState<0 | 1 | 2>(0);
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [direction, setDirection] = useState(['1', '0', '0']);
  const [tolerance, setTolerance] = useState('1');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState('');
  const inputKey = JSON.stringify([operation, source, axis, min, max, direction, tolerance, selected]);
  const previewCurrent = preview?.ir === ir && preview.inputKey === inputKey;
  const inputClass = 'w-full min-w-0 rounded px-2 py-1 text-sm';
  const style = { backgroundColor: 'var(--color-bg-input)', border: '1px solid var(--color-border)' };
  const text = (key: string) => t(`selectionEditing.${key}`);
  const parse = (value: string) => {
    const result = parseFiniteNumber(value);
    if (result === null) throw new Error('Invalid number');
    return result;
  };
  const showPreview = (saved?: NamedSelectionQuery) => {
    try {
      let predicate: SelectionPredicate;
      if (saved) predicate = saved.predicate;
      else if (operation === 'invert') predicate = { kind: 'all' };
      else if (source === 'coordinate_range') predicate = { kind: source, axis, min: min.trim() ? parse(min) : null, max: max.trim() ? parse(max) : null };
      else if (source === 'face_normal') predicate = { kind: source, direction: direction.map(parse) as [number, number, number], tolerance_degrees: parse(tolerance) };
      else predicate = { kind: 'ids', ids: [...selected] };
      const query: NamedSelectionQuery = saved ?? { version: 1, coordinate_frame: 'world', length_unit: 'm', operation, base_member_refs: [...selection.member_refs], predicate };
      const result = previewSelectionEdit(ir, selection, query);
      setPreview({ result, query, ir, inputKey }); setMessage('');
    } catch { setPreview(null); setMessage(text('invalid')); }
  };
  const apply = () => {
    if (!preview || !previewCurrent) { setMessage(text('changed')); return; }
    useAppStore.getState().updateNamedSelection(selection.id, { member_refs: preview.result.memberRefs, status: preview.result.status, query_definition: preview.query });
    setPreview(null); setMessage(text('applied'));
  };
  return <section className="space-y-2 rounded border p-2" style={{ borderColor: 'var(--color-border)' }} aria-label={text('title')}>
    <h4 className="text-sm font-bold">{text('title')}: {selection.display_name ?? selection.name}</h4>
    {!editableEntityType(selection.entity_type) ? <p role="status" className="text-xs">{t('selectionEditing.unsupported', { type: selection.entity_type })}</p> : <>
      <FormField label={text('operation')}>{(attrs) => <select {...attrs} className={inputClass} style={style} value={operation} onChange={(event) => setOperation(event.target.value as SelectionOperation)}>
        {(['add', 'remove', 'replace', 'invert'] as const).map((value) => <option key={value} value={value}>{text(value)}</option>)}
      </select>}</FormField>
      {operation === 'invert' ? <p className="text-xs">{text('invertHelp')}</p> : <>
        <FormField label={text('source')}>{(attrs) => <select {...attrs} className={inputClass} style={style} value={source} onChange={(event) => setSource(event.target.value as typeof source)}>
          <option value="ids">{text('ids')}</option><option value="coordinate_range">{text('coordinate_range')}</option>{selection.entity_type === 'face' && <option value="face_normal">{text('face_normal')}</option>}
        </select>}</FormField>
        {source === 'coordinate_range' && <>
          <p className="text-xs">{text('coordinates')}</p>
          <FormField label={text('axis')}>{(attrs) => <select {...attrs} value={axis} onChange={(event) => setAxis(Number(event.target.value) as typeof axis)} className={inputClass} style={style}>{['X', 'Y', 'Z'].map((name, index) => <option key={name} value={index}>{name}</option>)}</select>}</FormField>
          <div className="grid grid-cols-2 gap-2">{([['min', min, setMin], ['max', max, setMax]] as const).map(([name, value, setter]) => <FormField key={name} label={text(name)}>{(attrs) => <NumericDraftInput {...attrs} value={value} onValueChange={setter} className={inputClass} style={style} />}</FormField>)}</div>
        </>}
        {source === 'face_normal' && <>
          <p className="text-xs">{text('normals')}</p>
          <div className="grid grid-cols-3 gap-1">{direction.map((value, index) => <FormField key={index} label={`${text('direction')} ${'XYZ'[index]}`}>{(attrs) => <NumericDraftInput {...attrs} value={value} onValueChange={(next) => setDirection(direction.map((item, i) => i === index ? next : item))} className={inputClass} style={style} />}</FormField>)}</div>
          <FormField label={text('tolerance')}>{(attrs) => <NumericDraftInput {...attrs} value={tolerance} min={0} max={180} onValueChange={setTolerance} className={inputClass} style={style} />}</FormField>
        </>}
      </>}
      <button type="button" onClick={() => showPreview()} className="rounded px-2 py-1 text-sm" style={style}>{text('preview')}</button>
      {selection.query_definition && <button type="button" onClick={() => showPreview(selection.query_definition)} className="rounded px-2 py-1 text-sm" style={style}>{text('replay')}</button>}
      {preview && <div role="status" className="space-y-1 text-xs">
        <p>{t('selectionEditing.counts', { before: selection.member_refs.length, after: preview.result.memberRefs.length, added: preview.result.added, removed: preview.result.removed, matched: preview.result.matchedRefs.length })}</p>
        {preview.result.unavailableRefs.length > 0 && <p>{t('selectionEditing.unavailable', { count: preview.result.unavailableRefs.length })}</p>}
        {preview.result.staleRefs.length > 0 && <p>{t('selectionEditing.stale', { count: preview.result.staleRefs.length })}</p>}
        {!preview.result.memberRefs.length && <p>{text('empty')}</p>}
        {!previewCurrent && <p>{text('changed')}</p>}
        <details><summary>{text('saved')}</summary><pre className="overflow-x-auto">{JSON.stringify(preview.query, null, 2)}</pre><ul className="max-h-24 overflow-auto">{preview.result.memberRefs.map((id) => <li key={id}>{id}</li>)}</ul></details>
      </div>}
      <button type="button" onClick={apply} disabled={!preview || !previewCurrent} className="rounded px-2 py-1 text-sm disabled:opacity-40" style={style}>{text('apply')}</button>
      <p className="text-xs">{text('recipe')}</p>
    </>}
    {message && <p role="status" className="text-xs">{message}</p>}
    <button type="button" onClick={onClose} className="rounded px-2 py-1 text-sm" style={style}>{text('close')}</button>
  </section>;
}
