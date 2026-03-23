import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/state/store';
import { generateId } from '@/core/ir/id-generator';
import { SelectInput } from './common/SelectInput';
import type { AnalysisCase, AnalysisType, DomainType, SolverProfileHint } from '@/core/ir/types';

const ANALYSIS_TYPES: { value: AnalysisType; labelJa: string; labelEn: string }[] = [
  { value: 'static_linear', labelJa: '静的線形', labelEn: 'Static Linear' },
  { value: 'static_nonlinear', labelJa: '静的非線形', labelEn: 'Static Nonlinear' },
  { value: 'modal', labelJa: 'モーダル', labelEn: 'Modal' },
  { value: 'transient_structural', labelJa: '動的構造', labelEn: 'Transient Structural' },
  { value: 'steady_thermal', labelJa: '定常熱', labelEn: 'Steady Thermal' },
  { value: 'transient_thermal', labelJa: '非定常熱', labelEn: 'Transient Thermal' },
  { value: 'incompressible_flow_steady', labelJa: '定常非圧縮流', labelEn: 'Steady Incompressible Flow' },
  { value: 'incompressible_flow_transient', labelJa: '非定常非圧縮流', labelEn: 'Transient Incompressible Flow' },
];

const SOLVER_HINTS: { value: SolverProfileHint; label: string }[] = [
  { value: 'openseespy_frame_basic', label: 'OpenSeesPy Frame' },
  { value: 'dolfinx_linear_elasticity', label: 'DOLFINx Elasticity' },
  { value: 'dolfinx_poisson', label: 'DOLFINx Poisson' },
  { value: 'dolfinx_steady_heat', label: 'DOLFINx Heat' },
  { value: 'openfoam_simpleFoam', label: 'OpenFOAM simpleFoam' },
  { value: 'openfoam_pisoFoam', label: 'OpenFOAM pisoFoam' },
  { value: 'openfoam_laplacianFoam', label: 'OpenFOAM laplacianFoam' },
];

export function AnalysisCaseForm() {
  const { i18n } = useTranslation();
  const isJa = i18n.language === 'ja';
  const analysisCases = useAppStore((s) => s.ir.analysis_cases);
  const addCase = useAppStore((s) => s.addAnalysisCase);
  const updateCase = useAppStore((s) => s.updateAnalysisCase);
  const removeCase = useAppStore((s) => s.removeAnalysisCase);
  const domainType = useAppStore((s) => s.ir.meta.domain_type);

  const [editingId, setEditingId] = useState<string | null>(null);

  const handleAdd = () => {
    const ac: AnalysisCase = {
      id: generateId('analysis_case'),
      name: `Case_${analysisCases.length + 1}`,
      active: true,
      domain_type: domainType,
      analysis_type: domainType === 'fluid' ? 'incompressible_flow_steady' : domainType === 'thermal' ? 'steady_thermal' : 'static_linear',
      nonlinear: false,
      transient: false,
      participating_material_ids: [],
      participating_section_ids: [],
      participating_bc_ids: [],
      participating_load_ids: [],
      participating_ic_ids: [],
      mesh_policy_ref: '',
      solver_profile_hint: domainType === 'fluid' ? 'openfoam_simpleFoam' : domainType === 'thermal' ? 'dolfinx_steady_heat' : 'openseespy_frame_basic',
      result_requests: ['displacement'],
    };
    addCase(ac);
    setEditingId(ac.id);
  };

  const editing = editingId ? analysisCases.find((c) => c.id === editingId) : null;

  return (
    <div className="space-y-4">
      <button
        onClick={handleAdd}
        className="w-full py-2 rounded text-sm cursor-pointer"
        style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}
      >
        {isJa ? '解析ケースを追加' : 'Add Analysis Case'}
      </button>

      {editing && (
        <div className="p-3 rounded space-y-2" style={{ backgroundColor: 'var(--color-bg-input)', border: '1px solid var(--color-accent)' }}>
          <div className="flex items-center gap-2">
            <span className="text-sm w-28 shrink-0" style={{ color: 'var(--color-text-secondary)' }}>
              {isJa ? 'ケース名' : 'Case Name'}
            </span>
            <input
              type="text" value={editing.name}
              onChange={(e) => updateCase(editing.id, { name: e.target.value })}
              className="flex-1 px-2 py-1.5 rounded text-sm outline-none"
              style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
            />
          </div>
          <SelectInput
            label={isJa ? '領域タイプ' : 'Domain'}
            value={editing.domain_type}
            options={[
              { value: 'frame', label: isJa ? 'フレーム' : 'Frame' },
              { value: 'truss', label: isJa ? 'トラス' : 'Truss' },
              { value: 'solid', label: isJa ? 'ソリッド' : 'Solid' },
              { value: 'thermal', label: isJa ? '熱' : 'Thermal' },
              { value: 'fluid', label: isJa ? '流体' : 'Fluid' },
            ]}
            onChange={(v) => updateCase(editing.id, { domain_type: v as DomainType })}
          />
          <SelectInput
            label={isJa ? '解析タイプ' : 'Analysis Type'}
            value={editing.analysis_type}
            options={ANALYSIS_TYPES.map((at) => ({ value: at.value, label: isJa ? at.labelJa : at.labelEn }))}
            onChange={(v) => updateCase(editing.id, { analysis_type: v as AnalysisType })}
          />
          <SelectInput
            label={isJa ? 'ソルバヒント' : 'Solver Hint'}
            value={editing.solver_profile_hint}
            options={SOLVER_HINTS}
            onChange={(v) => updateCase(editing.id, { solver_profile_hint: v as SolverProfileHint })}
          />
          <button onClick={() => setEditingId(null)} className="w-full py-1.5 rounded text-sm cursor-pointer"
            style={{ backgroundColor: 'var(--color-bg-panel)', color: 'var(--color-text-secondary)' }}>
            {isJa ? '閉じる' : 'Close'}
          </button>
        </div>
      )}

      {analysisCases.length === 0 ? (
        <div className="text-sm text-center p-4" style={{ color: 'var(--color-text-muted)' }}>
          {isJa ? '解析ケースが定義されていません。' : 'No analysis cases defined.'}
        </div>
      ) : (
        <div className="space-y-1">
          {analysisCases.map((ac) => {
            const typeLabel = ANALYSIS_TYPES.find((at) => at.value === ac.analysis_type);
            return (
              <div key={ac.id} className="px-3 py-2 rounded text-sm flex items-center justify-between" style={{ backgroundColor: 'var(--color-bg-input)' }}>
                <div className="cursor-pointer" onClick={() => setEditingId(editingId === ac.id ? null : ac.id)}>
                  <span style={{ color: 'var(--color-text)' }}>{ac.name}</span>
                  <span className="text-xs ml-2" style={{ color: 'var(--color-text-muted)' }}>
                    {isJa ? typeLabel?.labelJa : typeLabel?.labelEn}
                  </span>
                </div>
                <button onClick={() => { removeCase(ac.id); if (editingId === ac.id) setEditingId(null); }}
                  className="text-xs px-1.5 cursor-pointer" style={{ color: 'var(--color-error)' }}>&times;</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
