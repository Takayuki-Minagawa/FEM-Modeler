import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/state/store';
import { generateId } from '@/core/ir/id-generator';
import { SelectInput } from './common/SelectInput';
import { VectorInput } from './common/VectorInput';
import { UnitInput } from './common/UnitInput';
import type { Load, LoadType, PhysicsDomain } from '@/core/ir/types';

const LOAD_TYPES_BY_DOMAIN: Record<PhysicsDomain, LoadType[]> = {
  structural: ['nodal_force', 'surface_traction', 'body_force', 'gravity', 'line_load', 'pressure'],
  thermal: ['heat_source', 'volumetric_heat'],
  fluid: ['body_force', 'mass_flow_rate'],
};

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

  const isSI = units.system_name === 'SI';
  const forceUnit = isSI ? 'N' : 'N';
  const pressureUnit = isSI ? 'Pa' : 'MPa';

  const handleAdd = () => {
    const loadType = LOAD_TYPES_BY_DOMAIN[domain][0];
    const load: Load = {
      id: generateId('load'),
      name: `Load_${loads.length + 1}`,
      physics_domain: domain,
      load_type: loadType,
      target_named_selection_id: namedSelections[0]?.id ?? '',
      application_mode: 'total',
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
            onChange={(v) => updateLoad(editingLoad.id, { load_type: v as LoadType })}
          />

          <SelectInput label={t('loads.target')} value={editingLoad.target_named_selection_id}
            options={[{ value: '', label: '—' }, ...namedSelections.map((ns) => ({ value: ns.id, label: ns.display_name ?? ns.name }))]}
            onChange={(v) => updateLoad(editingLoad.id, { target_named_selection_id: v })}
          />

          <UnitInput label={t('loads.magnitude')} value={editingLoad.magnitude}
            unit={editingLoad.load_type === 'pressure' ? pressureUnit : forceUnit}
            onChange={(v) => updateLoad(editingLoad.id, { magnitude: v ?? 0 })}
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
                    {t(`loads.types.${load.load_type}`)} {load.magnitude} → {ns?.display_name ?? ns?.name ?? '—'}
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
