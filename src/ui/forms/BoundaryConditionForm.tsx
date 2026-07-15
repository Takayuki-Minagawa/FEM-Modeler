import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/state/store';
import { generateId } from '@/core/ir/id-generator';
import { SelectInput } from './common/SelectInput';
import { VectorInput } from './common/VectorInput';
import { UnitInput } from './common/UnitInput';
import type { BoundaryCondition, BoundaryConditionType, PhysicsDomain, DofMap } from '@/core/ir/types';
import { fromSI, quantityUnitLabel, toSI, type QuantityKind } from '@/core/units';

const BC_TYPES_BY_DOMAIN: Record<PhysicsDomain, BoundaryConditionType[]> = {
  structural: ['fixed', 'prescribed_displacement'],
  thermal: ['temperature', 'heat_flux', 'convection', 'insulation'],
  fluid: ['velocity_inlet', 'pressure_outlet', 'wall', 'no_slip'],
};

function fixedDofMap(targetDimension?: number): DofMap {
  const rotation = targetDimension === 0 ? 'fixed' : 'free';
  return { ux: 'fixed', uy: 'fixed', uz: 'fixed', rx: rotation, ry: rotation, rz: rotation };
}

function defaultValuesFor(type: BoundaryConditionType, targetDimension?: number): BoundaryCondition['values'] {
  if (type === 'fixed') return { dof_map: fixedDofMap(targetDimension) };
  if (type === 'prescribed_displacement') {
    return { scalar: 0, dof_map: { ux: 'prescribed', uy: 'free', uz: 'free', rx: 'free', ry: 'free', rz: 'free' } };
  }
  if (type === 'velocity_inlet') return { vector: [1, 0, 0] };
  if (type === 'pressure_outlet') return { scalar: 0, pressure_basis: 'dynamic' };
  if (type === 'temperature') return { scalar: 293.15 };
  if (type === 'heat_flux') return { scalar: 0 };
  if (type === 'convection') return { heat_transfer_coefficient: 10, ambient_temperature: 293.15 };
  return {};
}

function scalarQuantity(type: BoundaryConditionType): QuantityKind {
  if (type === 'prescribed_displacement') return 'length';
  if (type === 'temperature') return 'temperature';
  if (type === 'heat_flux') return 'heat_flux';
  if (type === 'convection') return 'convection_coefficient';
  if (type === 'pressure_outlet') return 'pressure';
  return 'dimensionless';
}

function scalarQuantityForCondition(condition: BoundaryCondition): QuantityKind {
  return condition.bc_type === 'pressure_outlet' && condition.values.pressure_basis === 'kinematic'
    ? 'kinematic_pressure'
    : scalarQuantity(condition.bc_type);
}

function isValidBCTarget(type: BoundaryConditionType, dimension: number): boolean {
  if (type === 'fixed' || type === 'prescribed_displacement' || type === 'symmetry') return dimension === 0 || dimension === 2;
  return dimension === 2;
}

export function BoundaryConditionForm() {
  const { t } = useTranslation();
  const bcs = useAppStore((s) => s.ir.boundary_conditions);
  const namedSelections = useAppStore((s) => s.ir.named_selections);
  const addBC = useAppStore((s) => s.addBoundaryCondition);
  const updateBC = useAppStore((s) => s.updateBoundaryCondition);
  const removeBC = useAppStore((s) => s.removeBoundaryCondition);
  const unitSystem = useAppStore((s) => s.ir.units.system_name);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [domain, setDomain] = useState<PhysicsDomain>('structural');

  const handleAdd = () => {
    const bcType = BC_TYPES_BY_DOMAIN[domain][0];
    const target = namedSelections.find((item) => isValidBCTarget(bcType, item.target_dimension));
    const bc: BoundaryCondition = {
      id: generateId('boundary_condition'),
      name: `BC_${bcs.length + 1}`,
      physics_domain: domain,
      bc_type: bcType,
      target_named_selection_id: target?.id ?? '',
      coordinate_system: 'global',
      values: defaultValuesFor(bcType, target?.target_dimension),
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
            onChange={(v) => {
              const nextType = v as BoundaryConditionType;
              const currentTarget = namedSelections.find((item) => item.id === editingBC.target_named_selection_id);
              const target = currentTarget && isValidBCTarget(nextType, currentTarget.target_dimension)
                ? currentTarget
                : namedSelections.find((item) => isValidBCTarget(nextType, item.target_dimension));
              updateBC(editingBC.id, { bc_type: nextType, target_named_selection_id: target?.id ?? '', values: defaultValuesFor(nextType, target?.target_dimension) });
            }}
          />

          <SelectInput
            label={t('bc.target')}
            value={editingBC.target_named_selection_id}
            options={[{ value: '', label: '—' }, ...namedSelections.filter((ns) => isValidBCTarget(editingBC.bc_type, ns.target_dimension)).map((ns) => ({ value: ns.id, label: ns.display_name ?? ns.name }))]}
            onChange={(v) => {
              const target = namedSelections.find((item) => item.id === v);
              updateBC(editingBC.id, {
                target_named_selection_id: v,
                ...(editingBC.bc_type === 'fixed'
                  ? { values: defaultValuesFor('fixed', target?.target_dimension) }
                  : {}),
              });
            }}
          />

          {/* DOF selector for structural */}
          {editingBC.physics_domain === 'structural' && editingBC.values.dof_map && (() => {
            const dofMap = editingBC.values.dof_map!;
            return (
              <div>
                <span className="text-sm block mb-1" style={{ color: 'var(--color-text-secondary)' }}>DOF</span>
                <div className="grid grid-cols-3 gap-1">
                  {(editingBC.bc_type === 'prescribed_displacement'
                    ? (['ux', 'uy', 'uz'] as const)
                    : (['ux', 'uy', 'uz', 'rx', 'ry', 'rz'] as const)).map((dof) => (
                    <button
                      key={dof}
                      onClick={() => {
                        const map = { ...dofMap };
                        if (editingBC.bc_type === 'prescribed_displacement') {
                          map[dof] = map[dof] === 'prescribed' ? 'free' : 'prescribed';
                        } else {
                          map[dof] = map[dof] === 'fixed' ? 'free' : 'fixed';
                        }
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
            <UnitInput
              label={t('bc.values')}
              value={fromSI(editingBC.values.scalar, scalarQuantityForCondition(editingBC), unitSystem)}
              unit={quantityUnitLabel(scalarQuantityForCondition(editingBC), unitSystem)}
              onChange={(value) => updateBC(editingBC.id, {
                values: {
                  ...editingBC.values,
                  scalar: toSI(value ?? 0, scalarQuantityForCondition(editingBC), unitSystem),
                },
              })}
            />
          )}

          {editingBC.bc_type === 'convection' && (
            <>
              <UnitInput
                label={t('bc.filmCoefficient', { defaultValue: 'Film coefficient' })}
                value={fromSI(editingBC.values.heat_transfer_coefficient ?? 10, 'convection_coefficient', unitSystem)}
                unit={quantityUnitLabel('convection_coefficient', unitSystem)}
                min={0}
                onChange={(value) => updateBC(editingBC.id, {
                  values: {
                    ...editingBC.values,
                    heat_transfer_coefficient: toSI(value ?? 0, 'convection_coefficient', unitSystem),
                  },
                })}
              />
              <UnitInput
                label={t('bc.ambientTemperature', { defaultValue: 'Ambient temperature' })}
                value={fromSI(editingBC.values.ambient_temperature ?? 293.15, 'temperature', unitSystem)}
                unit={quantityUnitLabel('temperature', unitSystem)}
                onChange={(value) => updateBC(editingBC.id, {
                  values: {
                    ...editingBC.values,
                    ambient_temperature: toSI(value ?? 0, 'temperature', unitSystem),
                  },
                })}
              />
            </>
          )}

          {editingBC.bc_type === 'pressure_outlet' && (
            <SelectInput
              label={t('bc.pressureBasis', { defaultValue: 'Pressure basis' })}
              value={editingBC.values.pressure_basis ?? 'dynamic'}
              options={[
                { value: 'dynamic', label: 'Dynamic [Pa]' },
                { value: 'kinematic', label: 'Kinematic [m²/s²]' },
              ]}
              onChange={(value) => updateBC(editingBC.id, {
                values: { ...editingBC.values, scalar: 0, pressure_basis: value as 'dynamic' | 'kinematic' },
              })}
            />
          )}

          {/* Vector for velocity inlet */}
          {editingBC.bc_type === 'velocity_inlet' && (
            <VectorInput
              label={t('bc.direction')}
              value={(editingBC.values.vector ?? [0, 0, 0]).map((value) => fromSI(value, 'velocity', unitSystem)) as [number, number, number]}
              unit={quantityUnitLabel('velocity', unitSystem)}
              onChange={(v) => updateBC(editingBC.id, {
                values: { ...editingBC.values, vector: v.map((value) => toSI(value, 'velocity', unitSystem)) as [number, number, number] },
              })}
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
