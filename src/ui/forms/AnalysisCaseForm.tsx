import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/state/store';
import { generateId } from '@/core/ir/id-generator';
import { SelectInput } from './common/SelectInput';
import type {
  AnalysisCase,
  AnalysisType,
  DomainType,
  ResultRequest,
  SolverProfileHint,
} from '@/core/ir/types';

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

const STRICT_CASE_DEFAULTS: Record<Exclude<DomainType, 'coupled'>, {
  analysisType: AnalysisType;
  solverHint: SolverProfileHint;
  results: ResultRequest[];
}> = {
  frame: { analysisType: 'static_linear', solverHint: 'openseespy_frame_basic', results: ['displacement', 'reaction_force'] },
  truss: { analysisType: 'static_linear', solverHint: 'openseespy_frame_basic', results: ['displacement', 'reaction_force'] },
  solid: { analysisType: 'static_linear', solverHint: 'dolfinx_linear_elasticity', results: ['displacement'] },
  thermal: { analysisType: 'steady_thermal', solverHint: 'dolfinx_steady_heat', results: ['temperature'] },
  fluid: { analysisType: 'incompressible_flow_steady', solverHint: 'openfoam_simpleFoam', results: ['velocity', 'pressure'] },
};

const RESULT_OPTIONS: Array<{ value: ResultRequest; labelJa: string; labelEn: string }> = [
  { value: 'displacement', labelJa: '変位', labelEn: 'Displacement' },
  { value: 'reaction_force', labelJa: '反力', labelEn: 'Reaction force' },
  { value: 'temperature', labelJa: '温度', labelEn: 'Temperature' },
  { value: 'velocity', labelJa: '速度', labelEn: 'Velocity' },
  { value: 'pressure', labelJa: '圧力', labelEn: 'Pressure' },
];

function supportedCaseOptions(domain: DomainType) {
  const normalized = domain === 'coupled' ? 'solid' : domain;
  const defaults = STRICT_CASE_DEFAULTS[normalized];
  return {
    analysisTypes: ANALYSIS_TYPES.filter((item) => item.value === defaults.analysisType),
    solverHints: SOLVER_HINTS.filter((item) => {
      if (normalized === 'frame' || normalized === 'truss') return item.value === 'openseespy_frame_basic';
      if (normalized === 'solid') return item.value === 'dolfinx_linear_elasticity';
      if (normalized === 'thermal') return item.value === 'dolfinx_steady_heat' || item.value === 'dolfinx_poisson';
      return item.value === 'openfoam_simpleFoam';
    }),
    results: RESULT_OPTIONS.filter((item) => defaults.results.includes(item.value)),
  };
}

export function AnalysisCaseForm() {
  const { i18n } = useTranslation();
  const isJa = i18n.language === 'ja';
  const analysisCases = useAppStore((s) => s.ir.analysis_cases);
  const addCase = useAppStore((s) => s.addAnalysisCase);
  const updateCase = useAppStore((s) => s.updateAnalysisCase);
  const setActiveCase = useAppStore((s) => s.setActiveAnalysisCase);
  const removeCase = useAppStore((s) => s.removeAnalysisCase);
  const domainType = useAppStore((s) => s.ir.meta.domain_type);
  const materials = useAppStore((s) => s.ir.materials);
  const sections = useAppStore((s) => s.ir.sections);
  const boundaryConditions = useAppStore((s) => s.ir.boundary_conditions);
  const loads = useAppStore((s) => s.ir.loads);
  const initialConditions = useAppStore((s) => s.ir.initial_conditions);
  const openFoamOptions = useAppStore((s) => s.ir.solver_targets.find((target) => target.target_name === 'OpenFOAM')?.solver_options ?? {});
  const mutateIR = useAppStore((s) => s.mutateIR);

  const [editingId, setEditingId] = useState<string | null>(null);

  const handleAdd = () => {
    const normalizedDomain = domainType === 'coupled' ? 'solid' : domainType;
    const defaults = STRICT_CASE_DEFAULTS[normalizedDomain];
    const ac: AnalysisCase = {
      id: generateId('analysis_case'),
      name: `Case_${analysisCases.length + 1}`,
      active: true,
      domain_type: normalizedDomain,
      analysis_type: defaults.analysisType,
      nonlinear: false,
      transient: false,
      participating_material_ids: [],
      participating_section_ids: [],
      participating_bc_ids: [],
      participating_load_ids: [],
      participating_ic_ids: [],
      mesh_policy_ref: '',
      solver_profile_hint: defaults.solverHint,
      result_requests: [...defaults.results],
    };
    addCase(ac);
    setEditingId(ac.id);
  };

  const editing = editingId ? analysisCases.find((c) => c.id === editingId) : null;
  const editingOptions = editing ? supportedCaseOptions(editing.domain_type) : null;

  const changeDomain = (analysisCase: AnalysisCase, nextDomain: DomainType) => {
    const normalizedDomain = nextDomain === 'coupled' ? 'solid' : nextDomain;
    const defaults = STRICT_CASE_DEFAULTS[normalizedDomain];
    updateCase(analysisCase.id, {
      domain_type: normalizedDomain,
      analysis_type: defaults.analysisType,
      solver_profile_hint: defaults.solverHint,
      result_requests: [...defaults.results],
      nonlinear: false,
      transient: false,
    });
  };

  const changeAnalysisType = (analysisCase: AnalysisCase, analysisType: AnalysisType) => {
    updateCase(analysisCase.id, {
      analysis_type: analysisType,
      nonlinear: analysisType === 'static_nonlinear',
      transient: analysisType.startsWith('transient_') || analysisType === 'incompressible_flow_transient',
    });
  };

  const toggleResult = (analysisCase: AnalysisCase, result: ResultRequest) => {
    const selected = new Set(analysisCase.result_requests);
    if (selected.has(result)) selected.delete(result);
    else selected.add(result);
    updateCase(analysisCase.id, { result_requests: [...selected] });
  };

  const setOpenFoamDimensionality = (value: string) => {
    mutateIR(isJa ? 'OpenFOAM次元を変更' : 'Change OpenFOAM dimensionality', (ir) => {
      const target = ir.solver_targets.find((item) => item.target_name === 'OpenFOAM');
      if (!target) return;
      if (value !== '2D' && value !== '3D') {
        const rest = { ...target.solver_options };
        delete rest.dimensionality;
        delete rest.front_back_type;
        target.solver_options = rest;
        return;
      }
      target.solver_options = {
        ...target.solver_options,
        dimensionality: value,
        front_back_type: value === '2D'
          ? 'empty'
          : target.solver_options.front_back_type === 'patch' ? 'patch' : 'wall',
      };
    });
  };

  const setOpenFoamFrontBackType = (value: string) => {
    if (value !== 'wall' && value !== 'patch') return;
    mutateIR(isJa ? 'OpenFOAM前後面を変更' : 'Change OpenFOAM front/back patches', (ir) => {
      const target = ir.solver_targets.find((item) => item.target_name === 'OpenFOAM');
      if (target) target.solver_options = { ...target.solver_options, front_back_type: value };
    });
  };

  type ParticipationField =
    | 'participating_material_ids'
    | 'participating_section_ids'
    | 'participating_bc_ids'
    | 'participating_load_ids'
    | 'participating_ic_ids';

  const toggleParticipation = (
    analysisCase: AnalysisCase,
    field: ParticipationField,
    id: string,
    allIds: string[],
  ) => {
    const selected = new Set(analysisCase[field].length > 0 ? analysisCase[field] : allIds);
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    updateCase(analysisCase.id, { [field]: [...selected] });
  };

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
            onChange={(v) => changeDomain(editing, v as DomainType)}
          />
          <SelectInput
            label={isJa ? '解析タイプ' : 'Analysis Type'}
            value={editing.analysis_type}
            options={(editingOptions?.analysisTypes ?? []).map((at) => ({ value: at.value, label: isJa ? at.labelJa : at.labelEn }))}
            onChange={(v) => changeAnalysisType(editing, v as AnalysisType)}
          />
          <SelectInput
            label={isJa ? 'ソルバヒント' : 'Solver Hint'}
            value={editing.solver_profile_hint}
            options={editingOptions?.solverHints ?? []}
            onChange={(v) => updateCase(editing.id, { solver_profile_hint: v as SolverProfileHint })}
          />
          {editing.domain_type === 'fluid' && (
            <fieldset className="space-y-2 p-2 rounded" style={{ border: '1px solid var(--color-border)' }}>
              <legend className="text-xs px-1" style={{ color: 'var(--color-text-secondary)' }}>
                OpenFOAM
              </legend>
              <SelectInput
                label={isJa ? '解析次元（必須）' : 'Dimensionality (required)'}
                value={typeof openFoamOptions.dimensionality === 'string' ? openFoamOptions.dimensionality : ''}
                options={[
                  { value: '', label: isJa ? '未設定' : 'Not set' },
                  { value: '2D', label: '2D' },
                  { value: '3D', label: '3D' },
                ]}
                onChange={setOpenFoamDimensionality}
              />
              {openFoamOptions.dimensionality === '3D' && (
                <SelectInput
                  label={isJa ? '前後面タイプ' : 'Front/back patch type'}
                  value={openFoamOptions.front_back_type === 'patch' ? 'patch' : 'wall'}
                  options={[
                    { value: 'wall', label: 'wall' },
                    { value: 'patch', label: 'patch' },
                  ]}
                  onChange={setOpenFoamFrontBackType}
                />
              )}
            </fieldset>
          )}
          <fieldset className="space-y-1">
            <legend className="text-xs mb-1" style={{ color: 'var(--color-text-secondary)' }}>
              {isJa ? '出力要求' : 'Result requests'}
            </legend>
            {(editingOptions?.results ?? []).map((option) => (
              <label key={option.value} className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={editing.result_requests.includes(option.value)}
                  onChange={() => toggleResult(editing, option.value)}
                />
                <span>{isJa ? option.labelJa : option.labelEn}</span>
              </label>
            ))}
          </fieldset>
          {([
            ['participating_material_ids', isJa ? '参加材料' : 'Participating materials', materials],
            ['participating_section_ids', isJa ? '参加断面' : 'Participating sections', sections],
            ['participating_bc_ids', isJa ? '参加境界条件' : 'Participating BCs', boundaryConditions],
            ['participating_load_ids', isJa ? '参加荷重' : 'Participating loads', loads],
            ['participating_ic_ids', isJa ? '参加初期条件' : 'Participating ICs', initialConditions],
          ] as Array<[ParticipationField, string, Array<{ id: string; name: string }>]>).map(([field, label, entities]) => (
            entities.length > 0 && (
              <fieldset key={field} className="space-y-1">
                <legend className="text-xs mb-1" style={{ color: 'var(--color-text-secondary)' }}>{label}</legend>
                {entities.map((entity) => (
                  <label key={entity.id} className="flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editing[field].length === 0 || editing[field].includes(entity.id)}
                      onChange={() => toggleParticipation(editing, field, entity.id, entities.map((item) => item.id))}
                    />
                    <span>{entity.name}</span>
                  </label>
                ))}
              </fieldset>
            )
          ))}
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
                <div className="flex items-center gap-2 min-w-0">
                  <input
                    type="radio"
                    name="active-analysis-case"
                    checked={ac.active}
                    onChange={() => setActiveCase(ac.id)}
                    aria-label={isJa ? `${ac.name}を有効化` : `Activate ${ac.name}`}
                  />
                  <div className="cursor-pointer min-w-0" onClick={() => setEditingId(editingId === ac.id ? null : ac.id)}>
                  <span style={{ color: 'var(--color-text)' }}>{ac.name}</span>
                  <span className="text-xs ml-2" style={{ color: 'var(--color-text-muted)' }}>
                    {isJa ? typeLabel?.labelJa : typeLabel?.labelEn}
                  </span>
                  </div>
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
