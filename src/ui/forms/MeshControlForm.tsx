import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/state/store';
import { generateId } from '@/core/ir/id-generator';
import { UnitInput } from './common/UnitInput';
import { SelectInput } from './common/SelectInput';
import type { MeshLocalControl, MeshLocalControlType } from '@/core/ir/types';
import { fromSINullable, quantityUnitLabel, toSINullable } from '@/core/units';
import { estimateMeshPreview } from '@/mesh/preview';

export function MeshControlForm() {
  const { i18n } = useTranslation();
  const isJa = i18n.language === 'ja';
  const ir = useAppStore((s) => s.ir);
  const units = ir.units;
  const meshControls = ir.mesh_controls;
  const namedSelections = ir.named_selections;
  const unitSystem = units.system_name;
  const lengthUnit = quantityUnitLabel('length', unitSystem);
  const updateGlobal = useAppStore((s) => s.updateGlobalMeshControls);
  const addLocalControl = useAppStore((s) => s.addLocalMeshControl);
  const updateLocal = useAppStore((s) => s.updateLocalMeshControl);
  const removeLocalControl = useAppStore((s) => s.removeLocalMeshControl);
  const updateQuality = useAppStore((s) => s.updateMeshQualityTargets);
  const preview = useMemo(() => estimateMeshPreview(ir), [ir]);

  const [editingLocalId, setEditingLocalId] = useState<string | null>(null);

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
    addLocalControl(lc);
    setEditingLocalId(lc.id);
  };

  const removeLocal = (id: string) => {
    removeLocalControl(id);
    if (editingLocalId === id) setEditingLocalId(null);
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
            value={fromSINullable(meshControls.global.global_size, 'length', unitSystem)}
            unit={lengthUnit}
            onChange={(v) => updateGlobal({ global_size: toSINullable(v, 'length', unitSystem) })}
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
              value={fromSINullable(editingLocal.size, 'length', unitSystem)}
              unit={lengthUnit}
              onChange={(v) => updateLocal(editingLocal.id, { size: toSINullable(v, 'length', unitSystem) })}
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
                      {lc.size != null ? `${fromSINullable(lc.size, 'length', unitSystem)} ${lengthUnit}` : ''} → {ns?.display_name ?? ns?.name ?? '—'}
                    </span>
                  </div>
                  <button onClick={() => removeLocal(lc.id)} className="text-xs px-1.5 cursor-pointer" style={{ color: 'var(--color-error)' }}>&times;</button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pre-mesh estimate. These values are deliberately not presented as measured mesh data. */}
      <section aria-labelledby="mesh-preview-heading">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h3 id="mesh-preview-heading" className="text-sm font-bold" style={{ color: 'var(--color-text-muted)' }}>
            {isJa ? 'メッシュ事前推定' : 'Pre-mesh estimate'}
          </h3>
          <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: 'var(--color-bg-input)', color: 'var(--color-warning)' }}>
            {isJa ? '未生成・推定値' : 'Estimated, not generated'}
          </span>
        </div>
        <div className="space-y-2 p-3 rounded" style={{ backgroundColor: 'var(--color-bg-input)' }}>
          <div className="text-sm flex justify-between gap-3">
            <span>{isJa ? '推定要素数（合計）' : 'Estimated total elements'}</span>
            <strong>{preview.totalElementCount?.value.toLocaleString() ?? '—'}</strong>
          </div>
          {preview.bodies.map((body) => (
            <div key={body.bodyId} className="text-xs flex justify-between gap-3" style={{ color: 'var(--color-text-secondary)' }}>
              <span className="truncate">{body.bodyName} · {body.dimension}D</span>
              <span className="shrink-0">
                {body.elementCount?.value.toLocaleString() ?? '—'} {isJa ? '要素' : 'elements'}
              </span>
            </div>
          ))}
          <div className="text-xs pt-1" style={{ color: 'var(--color-text-muted)' }}>
            {isJa
              ? `品質値はメッシュ生成後のみ測定可能です（目標: Jacobian ≥ ${preview.quality.targets.minJacobian}, aspect ≤ ${preview.quality.targets.maxAspectRatio}）。`
              : `Quality is measurable only after meshing (targets: Jacobian ≥ ${preview.quality.targets.minJacobian}, aspect ≤ ${preview.quality.targets.maxAspectRatio}).`}
          </div>
          {preview.notices.map((notice) => (
            <div
              key={`${notice.code}:${notice.targetRef ?? ''}`}
              role={notice.severity === 'error' ? 'alert' : 'status'}
              className="text-xs p-2 rounded"
              style={{
                backgroundColor: 'var(--color-bg-secondary)',
                color: notice.severity === 'error'
                  ? 'var(--color-error)'
                  : notice.severity === 'warning' ? 'var(--color-warning)' : 'var(--color-text-muted)',
              }}
            >
              {notice.code}: {notice.message}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
