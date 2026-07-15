import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/state/store';
import { generateId } from '@/core/ir/id-generator';
import { SelectInput } from './common/SelectInput';
import { VectorInput } from './common/VectorInput';
import { UnitInput } from './common/UnitInput';
import type { Load, LoadApplicationMode, LoadType, PhysicsDomain } from '@/core/ir/types';
import { fromSI, quantityUnitLabel, toSI, type QuantityKind } from '@/core/units';

const LOAD_TYPES_BY_DOMAIN: Record<PhysicsDomain, LoadType[]> = {
  structural: ['nodal_force', 'surface_traction', 'body_force', 'gravity', 'line_load', 'pressure'],
  thermal: ['heat_source', 'volumetric_heat'],
  fluid: ['body_force', 'mass_flow_rate'],
};

function loadQuantity(load: Pick<Load, 'load_type' | 'application_mode'>): QuantityKind {
  if (load.load_type === 'gravity') return 'acceleration';
  if (load.load_type === 'mass_flow_rate') return 'mass_flow_rate';
  if (load.application_mode === 'total') {
    return load.load_type === 'heat_source' || load.load_type === 'volumetric_heat' ? 'power' : 'force';
  }
  if (load.application_mode === 'per_area') {
    if (load.load_type === 'pressure') return 'pressure';
    return load.load_type === 'heat_source' ? 'heat_flux' : 'surface_load';
  }
  if (load.application_mode === 'per_volume') {
    return load.load_type === 'heat_source' || load.load_type === 'volumetric_heat'
      ? 'volumetric_heat'
      : 'volume_load';
  }
  return 'line_load';
}

function applicationModes(type: LoadType): LoadApplicationMode[] {
  if (type === 'surface_traction') return ['per_area', 'total'];
  if (type === 'body_force') return ['per_volume', 'total'];
  if (type === 'line_load') return ['per_length', 'total'];
  if (type === 'pressure') return ['per_area'];
  if (type === 'heat_source') return ['per_area', 'total'];
  if (type === 'volumetric_heat') return ['per_volume', 'total'];
  return ['total'];
}

function requiredTargetDimension(type: LoadType): number {
  if (type === 'nodal_force') return 0;
  if (type === 'line_load') return 1;
  if (type === 'surface_traction' || type === 'pressure' || type === 'mass_flow_rate') return 2;
  if (type === 'heat_source') return 2;
  return 3;
}

export function LoadForm() {
  const { t } = useTranslation();
  const loads = useAppStore((s) => s.ir.loads);
  const namedSelections = useAppStore((s) => s.ir.named_selections);
  const addLoad = useAppStore((s) => s.addLoad);
  const updateLoad = useAppStore((s) => s.updateLoad);
  const removeLoad = useAppStore((s) => s.removeLoad);
  const units = useAppStore((s) => s.ir.units);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [domain, setDomain] = useState<PhysicsDomain>('structural');

  const unitSystem = units.system_name;

  const handleAdd = () => {
    const loadType = LOAD_TYPES_BY_DOMAIN[domain][0];
    const load: Load = {
      id: generateId('load'),
      name: `Load_${loads.length + 1}`,
      physics_domain: domain,
      load_type: loadType,
      target_named_selection_id: namedSelections.find((item) => item.target_dimension === requiredTargetDimension(loadType))?.id ?? '',
      application_mode: loadType === 'surface_traction' || loadType === 'pressure' || loadType === 'heat_source'
        ? 'per_area'
        : loadType === 'body_force' || loadType === 'volumetric_heat'
          ? 'per_volume'
          : loadType === 'line_load'
            ? 'per_length'
            : 'total',
      direction: [0, -1, 0],
      magnitude: loadType === 'gravity' ? 9.81 : 1000,
      distribution: 'uniform',
      temporal_profile: 'constant',
      load_case: 'default',
      coordinate_system: 'global',
      status: 'confirmed',
    };
    addLoad(load);
    setEditingId(load.id);
  };

  const editingLoad = editingId ? loads.find((l) => l.id === editingId) : null;

  return (
    <div className="space-y-4">
      {/* Domain selector */}
      <div className="flex gap-2">
        {(['structural', 'thermal', 'fluid'] as PhysicsDomain[]).map((d) => (
          <button
            key={d} onClick={() => setDomain(d)}
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

      <button onClick={handleAdd} className="w-full py-2 rounded text-sm cursor-pointer" style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}>
        {t('loads.addLoad')}
      </button>

      {/* Editing */}
      {editingLoad && (
        <div className="p-3 rounded space-y-2" style={{ backgroundColor: 'var(--color-bg-input)', border: '1px solid var(--color-accent)' }}>
          <div className="flex items-center gap-2">
            <span className="text-sm w-28 shrink-0" style={{ color: 'var(--color-text-secondary)' }}>{t('loads.name')}</span>
            <input type="text" value={editingLoad.name} onChange={(e) => updateLoad(editingLoad.id, { name: e.target.value })}
              className="flex-1 px-2 py-1.5 rounded text-sm outline-none"
              style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
            />
          </div>

          <SelectInput label={t('loads.type')} value={editingLoad.load_type}
            options={LOAD_TYPES_BY_DOMAIN[editingLoad.physics_domain].map((lt) => ({ value: lt, label: t(`loads.types.${lt}`) }))}
            onChange={(v) => {
              const nextType = v as LoadType;
              const dimension = requiredTargetDimension(nextType);
              const currentTarget = namedSelections.find((item) => item.id === editingLoad.target_named_selection_id);
              updateLoad(editingLoad.id, {
                load_type: nextType,
                target_named_selection_id: currentTarget?.target_dimension === dimension
                  ? currentTarget.id
                  : namedSelections.find((item) => item.target_dimension === dimension)?.id ?? '',
                application_mode: nextType === 'surface_traction' || nextType === 'pressure' || nextType === 'heat_source'
                  ? 'per_area'
                  : nextType === 'body_force' || nextType === 'volumetric_heat'
                    ? 'per_volume'
                    : nextType === 'line_load'
                      ? 'per_length'
                      : 'total',
              });
            }}
          />

          <SelectInput label={t('loads.target')} value={editingLoad.target_named_selection_id}
            options={[{ value: '', label: '—' }, ...namedSelections.filter((ns) => ns.target_dimension === requiredTargetDimension(editingLoad.load_type)).map((ns) => ({ value: ns.id, label: ns.display_name ?? ns.name }))]}
            onChange={(v) => updateLoad(editingLoad.id, { target_named_selection_id: v })}
          />

          <SelectInput
            label={t('loads.applicationMode', { defaultValue: 'Application mode' })}
            value={editingLoad.application_mode}
            options={applicationModes(editingLoad.load_type).map((mode) => ({
              value: mode,
              label: mode.replaceAll('_', ' '),
            }))}
            onChange={(value) => updateLoad(editingLoad.id, { application_mode: value as LoadApplicationMode })}
          />

          <UnitInput label={t('loads.magnitude')}
            value={fromSI(editingLoad.magnitude, loadQuantity(editingLoad), unitSystem)}
            unit={quantityUnitLabel(loadQuantity(editingLoad), unitSystem)}
            onChange={(v) => updateLoad(editingLoad.id, { magnitude: toSI(v ?? 0, loadQuantity(editingLoad), unitSystem) })}
          />

          <VectorInput label={t('loads.direction')} value={editingLoad.direction}
            onChange={(v) => updateLoad(editingLoad.id, { direction: v })}
          />

          <button onClick={() => setEditingId(null)} className="w-full py-1.5 rounded text-sm cursor-pointer"
            style={{ backgroundColor: 'var(--color-bg-panel)', color: 'var(--color-text-secondary)' }}>
            {t('common.apply')}
          </button>
        </div>
      )}

      {/* List */}
      {loads.length === 0 ? (
        <div className="text-sm text-center p-4" style={{ color: 'var(--color-text-muted)' }}>{t('loads.noLoads')}</div>
      ) : (
        <div className="space-y-1">
          {loads.map((load) => {
            const ns = namedSelections.find((n) => n.id === load.target_named_selection_id);
            return (
              <div key={load.id} className="px-3 py-2 rounded text-sm flex items-center justify-between" style={{ backgroundColor: 'var(--color-bg-input)' }}>
                <div className="cursor-pointer" onClick={() => setEditingId(editingId === load.id ? null : load.id)}>
                  <span style={{ color: 'var(--color-text)' }}>{load.name}</span>
                  <span className="text-xs ml-2" style={{ color: 'var(--color-text-muted)' }}>
                    {t(`loads.types.${load.load_type}`)} {fromSI(load.magnitude, loadQuantity(load), unitSystem)} {quantityUnitLabel(loadQuantity(load), unitSystem)} ({load.application_mode}) → {ns?.display_name ?? ns?.name ?? '—'}
                  </span>
                </div>
                <button onClick={() => { removeLoad(load.id); if (editingId === load.id) setEditingId(null); }}
                  className="text-xs px-1.5 cursor-pointer" style={{ color: 'var(--color-error)' }}>&times;</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
