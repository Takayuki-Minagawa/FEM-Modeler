import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/state/store';
import { generateId } from '@/core/ir/id-generator';
import type { NamedSelection, EntityType } from '@/core/ir/types';
import { EntityRow } from './common/EntityRow';
import { FormField } from './common/FormField';
import { SelectionMembershipEditor } from './SelectionMembershipEditor';
import { editableEntityType } from '@/core/selections/query';

const SELECTION_COLORS = ['#e53935', '#d81b60', '#8e24aa', '#5e35b1', '#3949ab', '#1e88e5', '#039be5', '#00acc1', '#00897b', '#43a047', '#7cb342', '#c0ca33', '#fdd835', '#ffb300', '#fb8c00', '#f4511e'];
let colorIdx = 0;

export function NamedSelectionsForm() {
  const { t, i18n } = useTranslation();
  const isJa = i18n.language === 'ja';
  const namedSelections = useAppStore((s) => s.ir.named_selections);
  const selectedEntityIds = useAppStore((s) => s.selectedEntityIds);
  const addNamedSelection = useAppStore((s) => s.addNamedSelection);
  const updateNamedSelection = useAppStore((s) => s.updateNamedSelection);
  const removeNamedSelection = useAppStore((s) => s.removeNamedSelection);
  const setSelectedEntities = useAppStore((s) => s.setSelectedEntities);
  const geometry = useAppStore((s) => s.ir.geometry);
  const setPickFilter = useAppStore((s) => s.setPickFilter);
  const toggleEntitySelection = useAppStore((s) => s.toggleEntitySelection);
  const [newName, setNewName] = useState('');
  const [entityType, setEntityType] = useState<EntityType>('body');
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const entities = entityType === 'body' ? geometry.bodies : entityType === 'face' ? geometry.faces : entityType === 'edge' ? geometry.edges : geometry.vertices;
  const bodiesById = useMemo(() => new Map(geometry.bodies.map((body) => [body.id, body])), [geometry.bodies]);
  const entityLabels = useMemo(() => {
    const labels = new Map<string, string>();
    for (const body of geometry.bodies) labels.set(body.id, `${body.name} / ${body.id}`);
    for (const collection of [geometry.faces, geometry.edges, geometry.vertices]) {
      for (const entity of collection) labels.set(entity.id, `${bodiesById.get(entity.body_id)?.name ?? entity.body_id} / ${entity.name} / ${entity.id}`);
    }
    return labels;
  }, [geometry, bodiesById]);
  const selectedSet = new Set(selectedEntityIds);
  const selectedCandidates = entities.filter((entity) => selectedSet.has(entity.id));
  const filtered = entities.filter((entity) => entityLabels.get(entity.id)?.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const groups = new Map<string, typeof filtered>();
  for (const entity of filtered) {
    const owner = 'body_id' in entity ? entity.body_id : entity.id;
    const group = groups.get(owner) ?? [];
    group.push(entity); groups.set(owner, group);
  }
  const handleCreate = () => {
    if (!newName.trim() || !selectedCandidates.length) return;
    addNamedSelection({
      id: generateId('named_selection'), name: newName.trim().replace(/\s+/g, '_'), display_name: newName.trim(),
      target_dimension: entityType === 'body' ? 3 : entityType === 'face' ? 2 : entityType === 'edge' ? 1 : 0,
      entity_type: entityType, member_refs: selectedCandidates.map((entity) => entity.id),
      color: SELECTION_COLORS[colorIdx++ % SELECTION_COLORS.length], description: '', created_by: 'user', status: 'active', usages: [],
    });
    setNewName('');
  };
  const startEdit = (selection: NamedSelection) => {
    setEditingId(selection.id); setEditName(selection.display_name ?? selection.name);
    if (editableEntityType(selection.entity_type)) { setEntityType(selection.entity_type); setPickFilter(selection.entity_type); setSelectedEntities(selection.member_refs); }
  };
  const commitEdit = () => {
    const current = namedSelections.find((selection) => selection.id === editingId);
    if (current && editName.trim() && editName.trim() !== (current.display_name ?? current.name)) updateNamedSelection(current.id, { name: editName.trim().replace(/\s+/g, '_'), display_name: editName.trim() });
  };
  const editing = namedSelections.find((selection) => selection.id === editingId);
  const inputClass = 'w-full min-w-0 px-2 py-1.5 rounded text-sm';
  const inputStyle = { backgroundColor: 'var(--color-bg-input)', color: 'var(--color-text)', border: '1px solid var(--color-border)' };

  return <div className="space-y-4">
    <section className="space-y-2" aria-label={isJa ? '新規名前付き選択' : 'New Named Selection'}>
      <h3 className="text-sm font-bold">{isJa ? '新規名前付き選択' : 'New Named Selection'}</h3>
      <div className="flex gap-2">
        {(['body', 'face', 'edge', 'vertex'] as const).map((type) => <button key={type} type="button" aria-pressed={entityType === type}
          onClick={() => { setEntityType(type); setPickFilter(type); setSelectedEntities([]); }} className="px-2 py-1 rounded text-xs"
          style={{ backgroundColor: entityType === type ? 'var(--color-accent)' : 'var(--color-bg-input)' }}>{type}</button>)}
      </div>
      <FormField label={t('workflow.entitySearch')}>{(attributes) => <input {...attributes} type="search" value={search} onChange={(event) => setSearch(event.target.value)} className={inputClass} style={inputStyle} />}</FormField>
      <p role="status" className="text-xs">{t('workflow.selectionCount', { selected: selectedCandidates.length, total: entities.length })}</p>
      <div className="max-h-52 overflow-y-auto rounded" role="listbox" aria-multiselectable="true" aria-label={isJa ? '選択可能エンティティ' : 'Selectable entities'}>
        {[...groups].map(([owner, items]) => <div key={owner} role="group" aria-label={`${bodiesById.get(owner)?.name ?? owner} (${owner})`}>
          <div aria-hidden="true" className="sticky top-0 px-2 py-1 text-xs font-bold break-words" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>{bodiesById.get(owner)?.name ?? owner}</div>
          {items.map((entity) => <button type="button" role="option" aria-selected={selectedSet.has(entity.id)} key={entity.id} onClick={() => toggleEntitySelection(entity.id)}
            className="w-full text-left px-2 py-2 text-xs flex gap-2 break-words" style={{ backgroundColor: selectedSet.has(entity.id) ? 'var(--color-bg-panel)' : 'var(--color-bg-input)' }}>
            <span aria-hidden="true">{selectedSet.has(entity.id) ? '✓' : '○'}</span><span className="min-w-0">{entityLabels.get(entity.id)}</span>
          </button>)}
        </div>)}
      </div>
      {!filtered.length && <p className="text-xs">{t('workflow.noEntities')}</p>}
      {selectedCandidates.length > 0 && <details className="text-xs"><summary>{isJa ? '選択中の識別子' : 'Selected identifiers'}</summary><ul className="max-h-32 overflow-y-auto">{selectedCandidates.map((entity) => <li key={entity.id} className="break-words">{entityLabels.get(entity.id)}</li>)}</ul></details>}
      <FormField label={t('workflow.selectionName')}>{(attributes) => <input {...attributes} type="text" value={newName} onChange={(event) => setNewName(event.target.value)}
        placeholder={isJa ? '選択名 (例: 上段の部材)' : 'Name (e.g. upper_members)'} className={inputClass} style={inputStyle} onKeyDown={(event) => { if (event.key === 'Enter') handleCreate(); }} />}</FormField>
      <button type="button" onClick={handleCreate} disabled={!newName.trim() || !selectedCandidates.length} className="px-3 py-1.5 rounded text-sm disabled:opacity-40" style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}>{isJa ? '作成' : 'Create'}</button>
      {!selectedCandidates.length && <p className="text-xs" style={{ color: 'var(--color-warning)' }}>{isJa ? '上の一覧または3Dビューで対象を選択してください。' : 'Select entities from the list above or the 3D view.'}</p>}
    </section>
    {editing && <FormField label={t('workflow.renameSelection', { name: editing.display_name ?? editing.name })}>
      {(attributes) => <input {...attributes} autoFocus type="text" value={editName} onChange={(event) => setEditName(event.target.value)} onBlur={commitEdit}
        onKeyDown={(event) => { if (event.key === 'Enter') commitEdit(); if (event.key === 'Escape') setEditingId(null); }} className={inputClass} style={inputStyle} />}
    </FormField>}
    {editing && <SelectionMembershipEditor key={editing.id} selection={editing} onClose={() => setEditingId(null)} />}
    {namedSelections.length > 0 && <section className="space-y-1" aria-label={isJa ? '名前付き選択一覧' : 'Named Selections'}>
      <h3 className="text-sm font-bold">{isJa ? '名前付き選択一覧' : 'Named Selections'} ({namedSelections.length})</h3>
      {namedSelections.map((selection) => <EntityRow key={selection.id} name={selection.display_name ?? selection.name} entityId={selection.id} color={selection.color}
        selected={selection.member_refs.length > 0 && selection.member_refs.every((id) => selectedSet.has(id)) && selection.member_refs.length === selectedSet.size}
        onSelect={() => setSelectedEntities(selection.member_refs)} onEdit={() => startEdit(selection)} onDelete={() => removeNamedSelection(selection.id)}>
        {selection.entity_type} · {selection.member_refs.length} · {selection.member_refs.map((id) => entityLabels.get(id) ?? id).join(', ')}
      </EntityRow>)}
    </section>}
  </div>;
}
