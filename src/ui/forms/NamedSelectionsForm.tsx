import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/state/store';
import { generateId } from '@/core/ir/id-generator';
import type { NamedSelection, EntityType } from '@/core/ir/types';

const SELECTION_COLORS = [
  '#e53935', '#d81b60', '#8e24aa', '#5e35b1',
  '#3949ab', '#1e88e5', '#039be5', '#00acc1',
  '#00897b', '#43a047', '#7cb342', '#c0ca33',
  '#fdd835', '#ffb300', '#fb8c00', '#f4511e',
];

let colorIdx = 0;
function nextSelectionColor(): string {
  return SELECTION_COLORS[colorIdx++ % SELECTION_COLORS.length];
}

export function NamedSelectionsForm() {
  const { i18n } = useTranslation();
  const isJa = i18n.language === 'ja';

  const namedSelections = useAppStore((s) => s.ir.named_selections);
  const selectedEntityIds = useAppStore((s) => s.selectedEntityIds);
  const addNamedSelection = useAppStore((s) => s.addNamedSelection);
  const updateNamedSelection = useAppStore((s) => s.updateNamedSelection);
  const removeNamedSelection = useAppStore((s) => s.removeNamedSelection);
  const setSelectedEntities = useAppStore((s) => s.setSelectedEntities);
  const bodies = useAppStore((s) => s.ir.geometry.bodies);
  const faces = useAppStore((s) => s.ir.geometry.faces);

  const [newName, setNewName] = useState('');
  const [entityType, setEntityType] = useState<EntityType>('body');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const handleCreate = () => {
    if (!newName.trim() || selectedEntityIds.length === 0) return;

    const ns: NamedSelection = {
      id: generateId('named_selection'),
      name: newName.trim().replace(/\s+/g, '_'),
      display_name: newName.trim(),
      target_dimension: entityType === 'body' ? 3 : entityType === 'face' ? 2 : entityType === 'edge' ? 1 : 0,
      entity_type: entityType,
      member_refs: [...selectedEntityIds],
      color: nextSelectionColor(),
      description: '',
      created_by: 'user',
      status: 'active',
      usages: [],
    };

    addNamedSelection(ns);
    setNewName('');
  };

  const handleHighlight = (ns: NamedSelection) => {
    setSelectedEntities(ns.member_refs);
  };

  const startEdit = (ns: NamedSelection) => {
    setEditingId(ns.id);
    setEditName(ns.display_name ?? ns.name);
  };

  const commitEdit = () => {
    if (editingId && editName.trim()) {
      updateNamedSelection(editingId, {
        name: editName.trim().replace(/\s+/g, '_'),
        display_name: editName.trim(),
      });
    }
    setEditingId(null);
  };

  const getMemberInfo = (ns: NamedSelection): string => {
    const count = ns.member_refs.length;
    if (ns.entity_type === 'body') {
      const names = ns.member_refs
        .map((ref) => bodies.find((b) => b.id === ref)?.name)
        .filter(Boolean);
      return names.length > 0 ? names.join(', ') : `${count} ${isJa ? '個' : 'items'}`;
    }
    if (ns.entity_type === 'face') {
      const names = ns.member_refs
        .map((ref) => faces.find((f) => f.id === ref)?.name)
        .filter(Boolean);
      return names.length > 0 ? names.join(', ') : `${count} ${isJa ? '面' : 'faces'}`;
    }
    return `${count} ${isJa ? '個' : 'items'}`;
  };

  return (
    <div className="space-y-4">
      {/* Create new */}
      <div>
        <label className="block text-sm font-bold mb-2" style={{ color: 'var(--color-text-muted)' }}>
          {isJa ? '新規名前付き選択' : 'New Named Selection'}
        </label>

        <div className="flex gap-2 mb-2">
          {(['body', 'face', 'edge', 'vertex'] as EntityType[]).map((et) => (
            <button
              key={et}
              onClick={() => setEntityType(et)}
              className="px-2 py-1 rounded text-xs cursor-pointer"
              style={{
                backgroundColor: entityType === et ? 'var(--color-accent)' : 'var(--color-bg-input)',
                color: entityType === et ? '#fff' : 'var(--color-text-secondary)',
                border: `1px solid ${entityType === et ? 'var(--color-accent)' : 'var(--color-border)'}`,
              }}
            >
              {et}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={isJa ? '選択名 (例: fixed_face)' : 'Name (e.g. fixed_face)'}
            className="flex-1 px-2 py-1.5 rounded text-sm outline-none"
            style={{
              backgroundColor: 'var(--color-bg-input)',
              color: 'var(--color-text)',
              border: '1px solid var(--color-border)',
            }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
          />
          <button
            onClick={handleCreate}
            disabled={!newName.trim() || selectedEntityIds.length === 0}
            className="px-3 py-1.5 rounded text-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              backgroundColor: 'var(--color-accent)',
              color: '#fff',
            }}
          >
            {isJa ? '作成' : 'Create'}
          </button>
        </div>

        {selectedEntityIds.length === 0 && (
          <p className="text-xs mt-1" style={{ color: 'var(--color-warning)' }}>
            {isJa ? '3Dビューワーでオブジェクトを選択してください' : 'Select objects in the 3D viewer first'}
          </p>
        )}
      </div>

      {/* List */}
      {namedSelections.length > 0 && (
        <div>
          <label className="block text-sm font-bold mb-2" style={{ color: 'var(--color-text-muted)' }}>
            {isJa ? '名前付き選択一覧' : 'Named Selections'} ({namedSelections.length})
          </label>
          <div className="space-y-1">
            {namedSelections.map((ns) => (
              <div
                key={ns.id}
                className="flex items-center gap-2 px-2 py-2 rounded text-sm cursor-pointer group"
                style={{ backgroundColor: 'var(--color-bg-input)' }}
                onClick={() => handleHighlight(ns)}
              >
                <span
                  className="w-3 h-3 rounded-sm shrink-0"
                  style={{ backgroundColor: ns.color }}
                />
                <div className="flex-1 min-w-0">
                  {editingId === ns.id ? (
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); }}
                      className="w-full px-1 py-0.5 rounded text-sm outline-none"
                      style={{
                        backgroundColor: 'var(--color-bg-secondary)',
                        color: 'var(--color-text)',
                      }}
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <div>
                      <span style={{ color: 'var(--color-text)' }}>
                        {ns.display_name ?? ns.name}
                      </span>
                      <span className="text-xs ml-2" style={{ color: 'var(--color-text-muted)' }}>
                        {ns.entity_type} | {getMemberInfo(ns)}
                      </span>
                    </div>
                  )}
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); startEdit(ns); }}
                  className="text-xs px-1 opacity-50 hover:opacity-100 cursor-pointer"
                  style={{ color: 'var(--color-text-muted)' }}
                  title={isJa ? '名前変更' : 'Rename'}
                >
                  &#9998;
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); removeNamedSelection(ns.id); }}
                  className="text-xs px-1 opacity-50 hover:opacity-100 cursor-pointer"
                  style={{ color: 'var(--color-error)' }}
                  title={isJa ? '削除' : 'Delete'}
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
