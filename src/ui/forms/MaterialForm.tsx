import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/state/store';
import { generateId } from '@/core/ir/id-generator';
import { createEmptyParameterSet } from '@/core/ir/defaults';
import { MATERIAL_LIBRARY, createMaterialFromLibrary } from '@/lib/material-library';
import { UnitInput } from './common/UnitInput';
import { SelectInput } from './common/SelectInput';
import type { Material, MaterialParameterKey } from '@/core/ir/types';

export function MaterialForm() {
  const { t, i18n } = useTranslation();
  const materials = useAppStore((s) => s.ir.materials);
  const materialAssignments = useAppStore((s) => s.ir.material_assignments);
  const namedSelections = useAppStore((s) => s.ir.named_selections);
  const units = useAppStore((s) => s.ir.units);
  const addMaterial = useAppStore((s) => s.addMaterial);
  const updateMaterial = useAppStore((s) => s.updateMaterial);
  const removeMaterial = useAppStore((s) => s.removeMaterial);
  const addMaterialAssignment = useAppStore((s) => s.addMaterialAssignment);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [assignMatId, setAssignMatId] = useState<string | null>(null);

  const isJa = i18n.language === 'ja';
  const isSI = units.system_name === 'SI';

  const unitMap: Record<MaterialParameterKey, string> = {
    density: isSI ? 'kg/m³' : 'kg/mm³',
    young_modulus: isSI ? 'Pa' : 'MPa',
    poisson_ratio: '—',
    thermal_conductivity: isSI ? 'W/(m·K)' : 'W/(mm·K)',
    specific_heat: 'J/(kg·K)',
    dynamic_viscosity: 'Pa·s',
    kinematic_viscosity: 'm²/s',
  };

  const paramKeys: { key: MaterialParameterKey; labelKey: string }[] = [
    { key: 'density', labelKey: 'materials.density' },
    { key: 'young_modulus', labelKey: 'materials.youngModulus' },
    { key: 'poisson_ratio', labelKey: 'materials.poissonRatio' },
    { key: 'thermal_conductivity', labelKey: 'materials.thermalConductivity' },
    { key: 'specific_heat', labelKey: 'materials.specificHeat' },
    { key: 'dynamic_viscosity', labelKey: 'materials.dynamicViscosity' },
    { key: 'kinematic_viscosity', labelKey: 'materials.kinematicViscosity' },
  ];

  const handleAddEmpty = () => {
    const mat: Material = {
      id: generateId('material'),
      name: isJa ? '新規材料' : 'New Material',
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
    const entry = MATERIAL_LIBRARY[idx];
    const mat = createMaterialFromLibrary(entry, i18n.language);
    addMaterial(mat);
    setShowLibrary(false);
    setEditingId(mat.id);
  };

  const handleParamChange = (matId: string, key: MaterialParameterKey, value: number | null) => {
    const mat = materials.find((m) => m.id === matId);
    if (!mat) return;
    const updated = { ...mat.parameter_set };
    updated[key] = { value, status: value !== null ? 'confirmed' : 'missing' };
    updateMaterial(matId, { parameter_set: updated });
  };

  const handleAssign = (matId: string, nsId: string) => {
    addMaterialAssignment({
      id: generateId('material_assignment'),
      material_id: matId,
      target_named_selection_id: nsId,
      override_allowed: true,
    });
    setAssignMatId(null);
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
          {MATERIAL_LIBRARY.map((entry, idx) => (
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
          <div className="flex items-center gap-2">
            <span className="text-sm w-28 shrink-0" style={{ color: 'var(--color-text-secondary)' }}>
              {t('materials.name')}
            </span>
            <input
              type="text"
              value={editingMat.name}
              onChange={(e) => updateMaterial(editingMat.id, { name: e.target.value })}
              className="flex-1 px-2 py-1.5 rounded text-sm outline-none"
              style={{
                backgroundColor: 'var(--color-bg-secondary)',
                color: 'var(--color-text)',
                border: '1px solid var(--color-border)',
              }}
            />
          </div>

          <SelectInput
            label={t('materials.class')}
            value={editingMat.class}
            options={[
              { value: 'elastic', label: isJa ? '弾性体' : 'Elastic' },
              { value: 'thermo_elastic', label: isJa ? '熱弾性体' : 'Thermo-Elastic' },
              { value: 'fluid_newtonian', label: isJa ? 'ニュートン流体' : 'Newtonian Fluid' },
            ]}
            onChange={(v) => updateMaterial(editingMat.id, { class: v as Material['class'] })}
          />

          {paramKeys.map(({ key, labelKey }) => (
            <UnitInput
              key={key}
              label={t(labelKey)}
              value={editingMat.parameter_set[key].value}
              unit={unitMap[key]}
              status={editingMat.parameter_set[key].status}
              onChange={(v) => handleParamChange(editingMat.id, key, v)}
            />
          ))}

          <button
            onClick={() => setEditingId(null)}
            className="w-full py-1.5 rounded text-sm cursor-pointer"
            style={{ backgroundColor: 'var(--color-bg-panel)', color: 'var(--color-text-secondary)' }}
          >
            {t('common.apply')}
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
            const nsNames = assignments.map((a) => {
              const ns = namedSelections.find((n) => n.id === a.target_named_selection_id);
              return ns?.display_name ?? ns?.name ?? '?';
            });

            return (
              <div
                key={mat.id}
                className="px-3 py-2 rounded text-sm"
                style={{
                  backgroundColor: editingId === mat.id ? 'var(--color-bg-panel)' : 'var(--color-bg-input)',
                }}
              >
                <div className="flex items-center justify-between">
                  <span
                    className="font-medium cursor-pointer"
                    style={{ color: 'var(--color-text)' }}
                    onClick={() => setEditingId(editingId === mat.id ? null : mat.id)}
                  >
                    {mat.name}
                  </span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setAssignMatId(assignMatId === mat.id ? null : mat.id)}
                      className="text-xs px-1.5 py-0.5 rounded cursor-pointer"
                      style={{ backgroundColor: 'var(--color-bg-panel)', color: 'var(--color-accent)' }}
                    >
                      {t('materials.assignTo')}
                    </button>
                    <button
                      onClick={() => { removeMaterial(mat.id); if (editingId === mat.id) setEditingId(null); }}
                      className="text-xs px-1.5 cursor-pointer"
                      style={{ color: 'var(--color-error)' }}
                    >
                      &times;
                    </button>
                  </div>
                </div>
                {nsNames.length > 0 && (
                  <div className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                    → {nsNames.join(', ')}
                  </div>
                )}

                {/* Assign dropdown */}
                {assignMatId === mat.id && (
                  <div className="mt-2 p-2 rounded space-y-1" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                    {namedSelections.length === 0 ? (
                      <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{t('common.noSelections')}</p>
                    ) : (
                      namedSelections.map((ns) => (
                        <button
                          key={ns.id}
                          onClick={() => handleAssign(mat.id, ns.id)}
                          className="w-full text-left px-2 py-1 rounded text-xs cursor-pointer flex items-center gap-2"
                          style={{ color: 'var(--color-text-secondary)' }}
                          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-bg-panel)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                        >
                          <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: ns.color }} />
                          {ns.display_name ?? ns.name}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
