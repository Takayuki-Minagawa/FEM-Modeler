import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/state/store';
import { generateId } from '@/core/ir/id-generator';
import { createEmptyParameterSet } from '@/core/ir/defaults';
import { MATERIAL_LIBRARY, createMaterialFromLibrary } from '@/lib/material-library';
import { UnitInput } from './common/UnitInput';
import { EntityRow } from './common/EntityRow';
import { FormField } from './common/FormField';
import { AssignmentPicker } from './common/AssignmentPicker';
import { DuplicateAction } from './common/BulkActions';
import { uniqueEntityName } from '@/core/ir/names';
import type { Material } from '@/core/ir/types';
import { fromSINullable, quantityUnitLabel, toSINullable } from '@/core/units';
import { modelFormsEn, modelFormsJa } from '@/i18n/locales/model-forms';

const PART_MATERIAL_LIBRARY = MATERIAL_LIBRARY.filter((entry) => entry.material.class !== 'fluid_newtonian');

export function MaterialForm() {
  const { t, i18n } = useTranslation();
  const materials = useAppStore((s) => s.ir.materials);
  const materialAssignments = useAppStore((s) => s.ir.material_assignments);
  const namedSelections = useAppStore((s) => s.ir.named_selections);
  const units = useAppStore((s) => s.ir.units);
  const addMaterial = useAppStore((s) => s.addMaterial);
  const updateMaterial = useAppStore((s) => s.updateMaterial);
  const removeMaterial = useAppStore((s) => s.removeMaterial);
  const removeMaterialAssignment = useAppStore((s) => s.removeMaterialAssignment);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [assignMatId, setAssignMatId] = useState<string | null>(null);

  const isJa = i18n.language === 'ja';
  const copy = isJa ? modelFormsJa : modelFormsEn;
  const unitSystem = units.system_name;

  const handleAddEmpty = () => {
    const mat: Material = {
      id: generateId('material'),
      name: uniqueEntityName(isJa ? '新規材料' : 'New Material', materials),
      class: 'elastic',
      physical_model: 'isotropic_linear',
      parameter_set: createEmptyParameterSet(),
      source: '',
      notes: '',
    };
    addMaterial(mat);
    setEditingId(mat.id);
  };

  const handleAddFromLibrary = (idx: number) => {
    const entry = PART_MATERIAL_LIBRARY[idx];
    const mat = createMaterialFromLibrary(entry, i18n.language);
    mat.name = uniqueEntityName(mat.name, materials);
    mat.parameter_set = { ...createEmptyParameterSet(), density: { ...mat.parameter_set.density } };
    addMaterial(mat);
    setShowLibrary(false);
    setEditingId(mat.id);
  };

  const handleDensityChange = (matId: string, value: number | null) => {
    const mat = materials.find((m) => m.id === matId);
    if (!mat) return;
    const updated = { ...mat.parameter_set };
    updated.density = {
      value: toSINullable(value, 'density', unitSystem),
      status: value !== null ? 'confirmed' : 'missing',
    };
    updateMaterial(matId, { parameter_set: updated });
  };

  const editingMat = editingId ? materials.find((m) => m.id === editingId) : null;

  return (
    <div className="space-y-4">
      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={handleAddEmpty}
          className="flex-1 py-2 rounded text-sm cursor-pointer"
          style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}
        >
          {t('materials.addMaterial')}
        </button>
        <button
          onClick={() => setShowLibrary(!showLibrary)}
          className="flex-1 py-2 rounded text-sm cursor-pointer"
          style={{
            backgroundColor: 'var(--color-bg-input)',
            color: 'var(--color-text-secondary)',
            border: '1px solid var(--color-border)',
          }}
        >
          {t('materials.library')}
        </button>
      </div>

      {/* Library dropdown */}
      {showLibrary && (
        <div className="space-y-1 p-2 rounded" style={{ backgroundColor: 'var(--color-bg-input)' }}>
          {PART_MATERIAL_LIBRARY.map((entry, idx) => (
            <button
              key={idx}
              onClick={() => handleAddFromLibrary(idx)}
              className="w-full text-left px-2 py-1.5 rounded text-sm cursor-pointer"
              style={{ color: 'var(--color-text-secondary)' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-bg-panel)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              {isJa ? entry.nameJa : entry.nameEn}
              <span className="text-xs ml-2" style={{ color: 'var(--color-text-muted)' }}>
                {entry.material.source}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Editing form */}
      {editingMat && (
        <div className="p-3 rounded space-y-2" style={{ backgroundColor: 'var(--color-bg-input)', border: '1px solid var(--color-accent)' }}>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{t('workflow.immediate')}</p>
          <DuplicateAction kind="material" itemId={editingMat.id} onDuplicated={setEditingId} />
          <FormField label={t('materials.name')}>{(attributes) => (
            <input
              {...attributes}
              type="text"
              value={editingMat.name}
              onChange={(e) => updateMaterial(editingMat.id, { name: e.target.value })}
              className="w-full min-w-0 px-2 py-1.5 rounded text-sm outline-none"
              style={{
                backgroundColor: 'var(--color-bg-secondary)',
                color: 'var(--color-text)',
                border: '1px solid var(--color-border)',
              }}
            />
          )}</FormField>

          <UnitInput
            label={copy.densityOptional}
            value={fromSINullable(editingMat.parameter_set.density.value, 'density', unitSystem)}
            unit={quantityUnitLabel('density', unitSystem)}
            status={editingMat.parameter_set.density.value === null ? undefined : editingMat.parameter_set.density.status}
            min={0}
            onChange={(value) => handleDensityChange(editingMat.id, value)}
          />
          <FormField label={copy.materialSource}>{(attributes) => <input {...attributes} type="text" value={editingMat.source}
            onChange={(event) => updateMaterial(editingMat.id, { source: event.target.value })}
            className="w-full min-w-0 px-2 py-1.5 rounded text-sm" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }} />}</FormField>
          <FormField label={copy.materialNotes}>{(attributes) => <textarea {...attributes} value={editingMat.notes} rows={3}
            onChange={(event) => updateMaterial(editingMat.id, { notes: event.target.value })}
            className="w-full min-w-0 px-2 py-1.5 rounded text-sm" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }} />}</FormField>

          <button
            onClick={() => setEditingId(null)}
            className="w-full py-1.5 rounded text-sm cursor-pointer"
            style={{ backgroundColor: 'var(--color-bg-panel)', color: 'var(--color-text-secondary)' }}
          >
            {t('workflow.close')}
          </button>
        </div>
      )}

      {/* Material list */}
      {materials.length === 0 ? (
        <div className="text-sm text-center p-4" style={{ color: 'var(--color-text-muted)' }}>
          {t('materials.noMaterials')}
        </div>
      ) : (
        <div className="space-y-1">
          {materials.map((mat) => {
            const assignments = materialAssignments.filter((a) => a.material_id === mat.id);
            return (
              <div
                key={mat.id}
                className="px-3 py-2 rounded text-sm"
                style={{
                  backgroundColor: editingId === mat.id ? 'var(--color-bg-panel)' : 'var(--color-bg-input)',
                }}
              >
                <EntityRow name={mat.name} entityId={mat.id} selected={editingId === mat.id}
                  onSelect={() => setEditingId(editingId === mat.id ? null : mat.id)}
                  onDelete={() => { removeMaterial(mat.id); if (editingId === mat.id) setEditingId(null); }} />
                    <button
                      type="button"
                      aria-label={`${t('materials.assignTo')}: ${mat.name} (${mat.id})`}
                      aria-expanded={assignMatId === mat.id}
                      onClick={() => setAssignMatId(assignMatId === mat.id ? null : mat.id)}
                      className="text-xs px-1.5 py-0.5 rounded cursor-pointer"
                      style={{ backgroundColor: 'var(--color-bg-panel)', color: 'var(--color-accent)' }}
                    >
                      {t('materials.assignTo')}
                    </button>
                {assignments.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {assignments.map((assignment) => {
                      const ns = namedSelections.find((item) => item.id === assignment.target_named_selection_id);
                      return (
                        <button
                          key={assignment.id}
                          type="button"
                          onClick={() => removeMaterialAssignment(assignment.id)}
                          className="text-xs px-1.5 py-0.5 rounded cursor-pointer"
                          style={{ color: 'var(--color-text-muted)', backgroundColor: 'var(--color-bg-secondary)' }}
                          title={isJa ? '割当を解除' : 'Remove assignment'}
                          aria-label={t('assignments.remove', { item: mat.name, target: `${ns?.display_name ?? ns?.name ?? '?'} (${ns?.id ?? assignment.target_named_selection_id})` })}
                        >
                          → {ns?.display_name ?? ns?.name ?? '?'} ×
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Assign dropdown */}
                {assignMatId === mat.id && (
                  <AssignmentPicker kind="material" itemId={mat.id} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
