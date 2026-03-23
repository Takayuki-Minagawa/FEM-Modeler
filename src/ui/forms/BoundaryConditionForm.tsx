import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/state/store';
import { generateId } from '@/core/ir/id-generator';
import { SelectInput } from './common/SelectInput';
import { VectorInput } from './common/VectorInput';
import type { BoundaryCondition, BoundaryConditionType, PhysicsDomain, DofMap } from '@/core/ir/types';

const BC_TYPES_BY_DOMAIN: Record<PhysicsDomain, BoundaryConditionType[]> = {
  structural: ['fixed', 'prescribed_displacement', 'symmetry'],
  thermal: ['temperature', 'heat_flux', 'convection', 'insulation'],
  fluid: ['velocity_inlet', 'pressure_outlet', 'wall', 'slip', 'no_slip'],
};

const DEFAULT_DOF_MAP: DofMap = { ux: 'fixed', uy: 'fixed', uz: 'fixed', rx: 'free', ry: 'free', rz: 'free' };

export function BoundaryConditionForm() {
  const { t } = useTranslation();
  const bcs = useAppStore((s) => s.ir.boundary_conditions);
  const namedSelections = useAppStore((s) => s.ir.named_selections);
  const addBC = useAppStore((s) => s.addBoundaryCondition);
  const updateBC = useAppStore((s) => s.updateBoundaryCondition);
  const removeBC = useAppStore((s) => s.removeBoundaryCondition);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [domain, setDomain] = useState<PhysicsDomain>('structural');

  const handleAdd = () => {
    const bcType = BC_TYPES_BY_DOMAIN[domain][0];
    const bc: BoundaryCondition = {
      id: generateId('boundary_condition'),
      name: `BC_${bcs.length + 1}`,
      physics_domain: domain,
      bc_type: bcType,
      target_named_selection_id: namedSelections[0]?.id ?? '',
      coordinate_system: 'global',
      values: domain === 'structural' ? { dof_map: { ...DEFAULT_DOF_MAP } } : { scalar: 0 },
      temporal_profile: 'constant',
      status: 'confirmed',
      notes: '',
    };
    addBC(bc);
    setEditingId(bc.id);
  };

  const editingBC = editingId ? bcs.find((b) => b.id === editingId) : null;

  return (
    <div className="space-y-4">
      {/* Domain selector + Add */}
      <div className="flex gap-2">
        {(['structural', 'thermal', 'fluid'] as PhysicsDomain[]).map((d) => (
          <button
            key={d}
            onClick={() => setDomain(d)}
            className="flex-1 py-1.5 rounded text-xs cursor-pointer"
            style={{
              backgroundColor: domain === d ? 'var(--color-accent)' : 'var(--color-bg-input)',
              color: domain === d ? '#fff' : 'var(--color-text-secondary)',
              border: `1px solid ${domain === d ? 'var(--color-accent)' : 'var(--color-border)'}`,
            }}
          >
            {t(`bc.${d}`)}
          </button>
        ))}
      </div>

      <button
        onClick={handleAdd}
        className="w-full py-2 rounded text-sm cursor-pointer"
        style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}
      >
        {t('bc.addBC')}
      </button>

      {/* Editing */}
      {editingBC && (
        <div className="p-3 rounded space-y-2" style={{ backgroundColor: 'var(--color-bg-input)', border: '1px solid var(--color-accent)' }}>
          <div className="flex items-center gap-2">
            <span className="text-sm w-28 shrink-0" style={{ color: 'var(--color-text-secondary)' }}>{t('bc.name')}</span>
            <input
              type="text" value={editingBC.name}
              onChange={(e) => updateBC(editingBC.id, { name: e.target.value })}
              className="flex-1 px-2 py-1.5 rounded text-sm outline-none"
              style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
            />
          </div>

          <SelectInput
            label={t('bc.type')}
            value={editingBC.bc_type}
            options={BC_TYPES_BY_DOMAIN[editingBC.physics_domain].map((bt) => ({ value: bt, label: t(`bc.types.${bt}`) }))}
            onChange={(v) => updateBC(editingBC.id, { bc_type: v as BoundaryConditionType })}
          />

          <SelectInput
            label={t('bc.target')}
            value={editingBC.target_named_selection_id}
            options={[{ value: '', label: '—' }, ...namedSelections.map((ns) => ({ value: ns.id, label: ns.display_name ?? ns.name }))]}
            onChange={(v) => updateBC(editingBC.id, { target_named_selection_id: v })}
          />

          {/* DOF selector for structural */}
          {editingBC.physics_domain === 'structural' && editingBC.values.dof_map && (() => {
            const dofMap = editingBC.values.dof_map!;
            return (
              <div>
                <span className="text-sm block mb-1" style={{ color: 'var(--color-text-secondary)' }}>DOF</span>
                <div className="grid grid-cols-3 gap-1">
                  {(['ux', 'uy', 'uz', 'rx', 'ry', 'rz'] as const).map((dof) => (
                    <button
                      key={dof}
                      onClick={() => {
                        const map = { ...dofMap };
                        map[dof] = map[dof] === 'fixed' ? 'free' : 'fixed';
                        updateBC(editingBC.id, { values: { ...editingBC.values, dof_map: map } });
                      }}
                      className="px-2 py-1 rounded text-xs cursor-pointer"
                      style={{
                        backgroundColor: dofMap[dof] === 'fixed' ? 'var(--color-error)' : 'var(--color-bg-panel)',
                        color: dofMap[dof] === 'fixed' ? '#fff' : 'var(--color-text-muted)',
                      }}
                    >
                      {t(`bc.dof.${dof}`)} : {t(`bc.dof.${dofMap[dof]}`)}
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Scalar value for thermal/fluid */}
          {editingBC.values.scalar !== undefined && (
            <div className="flex items-center gap-2">
              <span className="text-sm w-28 shrink-0" style={{ color: 'var(--color-text-secondary)' }}>{t('bc.values')}</span>
              <input
                type="number" value={editingBC.values.scalar ?? 0}
                onChange={(e) => updateBC(editingBC.id, { values: { ...editingBC.values, scalar: parseFloat(e.target.value) || 0 } })}
                className="flex-1 px-2 py-1.5 rounded text-sm outline-none"
                style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
              />
            </div>
          )}

          {/* Vector for velocity inlet */}
          {editingBC.bc_type === 'velocity_inlet' && (
            <VectorInput
              label={t('bc.direction')}
              value={editingBC.values.vector ?? [0, 0, 0]}
              onChange={(v) => updateBC(editingBC.id, { values: { ...editingBC.values, vector: v } })}
            />
          )}

          <button onClick={() => setEditingId(null)} className="w-full py-1.5 rounded text-sm cursor-pointer" style={{ backgroundColor: 'var(--color-bg-panel)', color: 'var(--color-text-secondary)' }}>
            {t('common.apply')}
          </button>
        </div>
      )}

      {/* List */}
      {bcs.length === 0 ? (
        <div className="text-sm text-center p-4" style={{ color: 'var(--color-text-muted)' }}>{t('bc.noBC')}</div>
      ) : (
        <div className="space-y-1">
          {bcs.map((bc) => {
            const ns = namedSelections.find((n) => n.id === bc.target_named_selection_id);
            return (
              <div key={bc.id} className="px-3 py-2 rounded text-sm flex items-center justify-between" style={{ backgroundColor: 'var(--color-bg-input)' }}>
                <div className="cursor-pointer" onClick={() => setEditingId(editingId === bc.id ? null : bc.id)}>
                  <span style={{ color: 'var(--color-text)' }}>{bc.name}</span>
                  <span className="text-xs ml-2" style={{ color: 'var(--color-text-muted)' }}>
                    {t(`bc.types.${bc.bc_type}`)} → {ns?.display_name ?? ns?.name ?? '—'}
                  </span>
                </div>
                <button onClick={() => { removeBC(bc.id); if (editingId === bc.id) setEditingId(null); }} className="text-xs px-1.5 cursor-pointer" style={{ color: 'var(--color-error)' }}>&times;</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
