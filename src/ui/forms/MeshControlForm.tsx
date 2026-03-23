import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/state/store';
import { generateId } from '@/core/ir/id-generator';
import { UnitInput } from './common/UnitInput';
import { SelectInput } from './common/SelectInput';
import type { MeshLocalControl, MeshLocalControlType } from '@/core/ir/types';

export function MeshControlForm() {
  const { i18n } = useTranslation();
  const isJa = i18n.language === 'ja';
  const ir = useAppStore((s) => s.ir);
  const units = ir.units;
  const meshControls = ir.mesh_controls;
  const namedSelections = ir.named_selections;

  const isSI = units.system_name === 'SI';
  const lengthUnit = isSI ? 'm' : 'mm';

  const [editingLocalId, setEditingLocalId] = useState<string | null>(null);

  // Global mesh update
  const updateGlobal = (updates: Partial<typeof meshControls.global>) => {
    useAppStore.setState((state) => {
      const s = state as import('@/state/store').AppState;
      Object.assign(s.ir.mesh_controls.global, updates);
      s.ir.meta.updated_at = new Date().toISOString();
    });
  };

  // Local mesh add/update/remove
  const addLocal = () => {
    const lc: MeshLocalControl = {
      id: generateId('mesh_local'),
      target_named_selection_id: namedSelections[0]?.id ?? '',
      control_type: 'local_size',
      size: (meshControls.global.global_size ?? 1) * 0.5,
      layers: null,
      bias: null,
      transfinite_hint: false,
      boundary_layer_hint: false,
      priority: 0,
    };
    useAppStore.setState((state) => {
      const s = state as import('@/state/store').AppState;
      s.ir.mesh_controls.local.push(lc);
      s.ir.meta.updated_at = new Date().toISOString();
    });
    setEditingLocalId(lc.id);
  };

  const updateLocal = (id: string, updates: Partial<MeshLocalControl>) => {
    useAppStore.setState((state) => {
      const s = state as import('@/state/store').AppState;
      const idx = s.ir.mesh_controls.local.findIndex((l) => l.id === id);
      if (idx >= 0) Object.assign(s.ir.mesh_controls.local[idx], updates);
      s.ir.meta.updated_at = new Date().toISOString();
    });
  };

  const removeLocal = (id: string) => {
    useAppStore.setState((state) => {
      const s = state as import('@/state/store').AppState;
      s.ir.mesh_controls.local = s.ir.mesh_controls.local.filter((l) => l.id !== id);
      s.ir.meta.updated_at = new Date().toISOString();
    });
    if (editingLocalId === id) setEditingLocalId(null);
  };

  const updateQuality = (updates: Partial<typeof meshControls.quality_targets>) => {
    useAppStore.setState((state) => {
      const s = state as import('@/state/store').AppState;
      Object.assign(s.ir.mesh_controls.quality_targets, updates);
      s.ir.meta.updated_at = new Date().toISOString();
    });
  };

  const editingLocal = editingLocalId ? meshControls.local.find((l) => l.id === editingLocalId) : null;

  const controlTypeOptions: { value: MeshLocalControlType; label: string }[] = [
    { value: 'local_size', label: isJa ? '局所サイズ' : 'Local Size' },
    { value: 'edge_division', label: isJa ? '辺分割' : 'Edge Division' },
    { value: 'face_refinement', label: isJa ? '面細分' : 'Face Refinement' },
    { value: 'boundary_layer', label: isJa ? '境界層' : 'Boundary Layer' },
    { value: 'structured_hint', label: isJa ? '構造格子ヒント' : 'Structured Hint' },
  ];

  return (
    <div className="space-y-5">
      {/* Global settings */}
      <div>
        <label className="block text-sm font-bold mb-2" style={{ color: 'var(--color-text-muted)' }}>
          {isJa ? '全体メッシュ設定' : 'Global Mesh Settings'}
        </label>
        <div className="space-y-2 p-3 rounded" style={{ backgroundColor: 'var(--color-bg-input)' }}>
          <UnitInput
            label={isJa ? '要素サイズ' : 'Element Size'}
            value={meshControls.global.global_size}
            unit={lengthUnit}
            onChange={(v) => updateGlobal({ global_size: v })}
          />
          <UnitInput
            label={isJa ? '成長率' : 'Growth Rate'}
            value={meshControls.global.growth_rate}
            unit="—"
            step={0.05}
            onChange={(v) => updateGlobal({ growth_rate: v ?? 1.2 })}
          />
          <SelectInput
            label={isJa ? '要素次数' : 'Element Order'}
            value={String(meshControls.global.element_order)}
            options={[
              { value: '1', label: isJa ? '1次 (線形)' : '1st order (linear)' },
              { value: '2', label: isJa ? '2次 (二次)' : '2nd order (quadratic)' },
            ]}
            onChange={(v) => updateGlobal({ element_order: parseInt(v) as 1 | 2 })}
          />
          <SelectInput
            label={isJa ? 'アルゴリズム' : 'Algorithm'}
            value={meshControls.global.algorithm_preference}
            options={[
              { value: 'auto', label: isJa ? '自動' : 'Auto' },
              { value: 'delaunay', label: 'Delaunay' },
              { value: 'frontal', label: 'Frontal' },
              { value: 'structured', label: isJa ? '構造格子' : 'Structured' },
            ]}
            onChange={(v) => updateGlobal({ algorithm_preference: v as typeof meshControls.global.algorithm_preference })}
          />
          <div className="flex items-center gap-2">
            <span className="text-sm w-28 shrink-0" style={{ color: 'var(--color-text-secondary)' }}>
              {isJa ? '曲率追従' : 'Curvature'}
            </span>
            <button
              onClick={() => updateGlobal({ curvature_based_refinement: !meshControls.global.curvature_based_refinement })}
              className="px-3 py-1 rounded text-sm cursor-pointer"
              style={{
                backgroundColor: meshControls.global.curvature_based_refinement ? 'var(--color-accent)' : 'var(--color-bg-panel)',
                color: meshControls.global.curvature_based_refinement ? '#fff' : 'var(--color-text-muted)',
              }}
            >
              {meshControls.global.curvature_based_refinement ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>
      </div>

      {/* Quality targets */}
      <div>
        <label className="block text-sm font-bold mb-2" style={{ color: 'var(--color-text-muted)' }}>
          {isJa ? '品質目標' : 'Quality Targets'}
        </label>
        <div className="space-y-2 p-3 rounded" style={{ backgroundColor: 'var(--color-bg-input)' }}>
          <SelectInput
            label={isJa ? '品質レベル' : 'Quality Level'}
            value={meshControls.quality_targets.preferred_quality_level}
            options={[
              { value: 'preview', label: isJa ? 'プレビュー (粗い)' : 'Preview (coarse)' },
              { value: 'balanced', label: isJa ? 'バランス' : 'Balanced' },
              { value: 'high_quality', label: isJa ? '高品質' : 'High Quality' },
            ]}
            onChange={(v) => updateQuality({ preferred_quality_level: v as typeof meshControls.quality_targets.preferred_quality_level })}
          />
          <UnitInput
            label={isJa ? '最大アスペクト比' : 'Max Aspect Ratio'}
            value={meshControls.quality_targets.max_aspect_ratio}
            unit="—"
            onChange={(v) => updateQuality({ max_aspect_ratio: v ?? 10 })}
          />
        </div>
      </div>

      {/* Local refinements */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-bold" style={{ color: 'var(--color-text-muted)' }}>
            {isJa ? '局所設定' : 'Local Refinements'} ({meshControls.local.length})
          </label>
          <button
            onClick={addLocal}
            className="px-2 py-1 rounded text-xs cursor-pointer"
            style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}
          >
            + {isJa ? '追加' : 'Add'}
          </button>
        </div>

        {/* Editing local control */}
        {editingLocal && (
          <div className="p-3 rounded space-y-2 mb-2" style={{ backgroundColor: 'var(--color-bg-input)', border: '1px solid var(--color-accent)' }}>
            <SelectInput
              label={isJa ? '種別' : 'Type'}
              value={editingLocal.control_type}
              options={controlTypeOptions}
              onChange={(v) => updateLocal(editingLocal.id, { control_type: v as MeshLocalControlType })}
            />
            <SelectInput
              label={isJa ? '対象' : 'Target'}
              value={editingLocal.target_named_selection_id}
              options={[{ value: '', label: '—' }, ...namedSelections.map((ns) => ({ value: ns.id, label: ns.display_name ?? ns.name }))]}
              onChange={(v) => updateLocal(editingLocal.id, { target_named_selection_id: v })}
            />
            <UnitInput
              label={isJa ? 'サイズ' : 'Size'}
              value={editingLocal.size}
              unit={lengthUnit}
              onChange={(v) => updateLocal(editingLocal.id, { size: v })}
            />
            {editingLocal.control_type === 'boundary_layer' && (
              <UnitInput
                label={isJa ? '層数' : 'Layers'}
                value={editingLocal.layers}
                unit="—"
                step={1}
                onChange={(v) => updateLocal(editingLocal.id, { layers: v })}
              />
            )}
            <button
              onClick={() => setEditingLocalId(null)}
              className="w-full py-1.5 rounded text-sm cursor-pointer"
              style={{ backgroundColor: 'var(--color-bg-panel)', color: 'var(--color-text-secondary)' }}
            >
              {isJa ? '閉じる' : 'Close'}
            </button>
          </div>
        )}

        {/* Local controls list */}
        {meshControls.local.length > 0 && (
          <div className="space-y-1">
            {meshControls.local.map((lc) => {
              const ns = namedSelections.find((n) => n.id === lc.target_named_selection_id);
              const typeLabel = controlTypeOptions.find((o) => o.value === lc.control_type)?.label ?? lc.control_type;
              return (
                <div key={lc.id} className="px-3 py-2 rounded text-sm flex items-center justify-between" style={{ backgroundColor: 'var(--color-bg-input)' }}>
                  <div className="cursor-pointer" onClick={() => setEditingLocalId(editingLocalId === lc.id ? null : lc.id)}>
                    <span style={{ color: 'var(--color-text)' }}>{typeLabel}</span>
                    <span className="text-xs ml-2" style={{ color: 'var(--color-text-muted)' }}>
                      {lc.size != null ? `${lc.size} ${lengthUnit}` : ''} → {ns?.display_name ?? ns?.name ?? '—'}
                    </span>
                  </div>
                  <button onClick={() => removeLocal(lc.id)} className="text-xs px-1.5 cursor-pointer" style={{ color: 'var(--color-error)' }}>&times;</button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
