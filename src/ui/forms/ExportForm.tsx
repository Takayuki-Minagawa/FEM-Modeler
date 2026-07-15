import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/state/store';
import { downloadConditionsCsv } from '@/export/project/csv-export';
import { downloadMarkdownSummary } from '@/export/project/markdown-summary';
import { useAppContext } from '@/hooks/useAppContext';
import type { SolverTargetName } from '@/core/ir/types';
import { preflightExport, SOLVER_CAPABILITIES } from '@/export/compiler';

export function ExportForm() {
  const { i18n } = useTranslation();
  const isJa = i18n.language === 'ja';
  const { addActivity, saveProjectFile, recordExportResult } = useAppContext();
  const ir = useAppStore((s) => s.ir);
  const validation = useAppStore((s) => s.ir.validation);
  const runValidation = useAppStore((s) => s.runValidation);
  const setSolverTargetEnabled = useAppStore((s) => s.setSolverTargetEnabled);
  const setActivePanel = useAppStore((s) => s.setActivePanel);

  const [exporting, setExporting] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ target: string; errors: string[]; warnings: string[] } | null>(null);
  const [requestedAnalysisCaseId, setRequestedAnalysisCaseId] = useState(() => ir.analysis_cases.find((item) => item.active)?.id ?? ir.analysis_cases[0]?.id ?? '');
  const [coverageTarget, setCoverageTarget] = useState<SolverTargetName>(() => (
    ['OpenSeesPy', 'DOLFINx', 'OpenFOAM'].includes(ir.meta.default_solver_target)
      ? ir.meta.default_solver_target as SolverTargetName
      : 'OpenSeesPy'
  ));

  const analysisCaseId = ir.analysis_cases.some((item) => item.id === requestedAnalysisCaseId)
    ? requestedAnalysisCaseId
    : ir.analysis_cases.find((item) => item.active)?.id ?? ir.analysis_cases[0]?.id ?? '';

  const errorCount = validation.summary.error_count;

  const handleExport = async (target: string) => {
    const solverTargets: SolverTargetName[] = ['OpenSeesPy', 'DOLFINx', 'OpenFOAM'];
    const solverTarget = solverTargets.includes(target as SolverTargetName) ? target as SolverTargetName : undefined;
    runValidation(solverTarget, analysisCaseId || undefined);

    // Block solver exports when validation errors exist
    if (solverTarget) {
      const currentErrors = useAppStore.getState().ir.validation.summary.error_count;
      if (currentErrors > 0) {
        const blockedErrors = [isJa
          ? `${currentErrors}件の検証エラーがあります。エラーを解消してからエクスポートしてください。`
          : `${currentErrors} validation error(s) found. Resolve errors before exporting.`];
        addActivity(
          'warning',
          isJa
            ? `${target} のエクスポートを検証エラーのため中止しました。`
            : `Blocked ${target} export because validation errors remain.`,
        );
        recordExportResult(target, blockedErrors, []);
        setLastResult({
          target,
          errors: blockedErrors,
          warnings: [],
        });
        return;
      }
    }

    setExporting(target);
    try {
      let result: { errors: string[]; warnings: string[] };
      switch (target) {
        case 'OpenSeesPy':
          result = await (await import('@/export/openseespy/exporter')).downloadOpenSeesPyZip(ir, analysisCaseId);
          break;
        case 'DOLFINx':
          result = await (await import('@/export/dolfinx/exporter')).downloadDOLFINxZip(ir, analysisCaseId);
          break;
        case 'OpenFOAM':
          result = await (await import('@/export/openfoam/exporter')).downloadOpenFOAMZip(ir, analysisCaseId);
          break;
        case 'JSON':
          saveProjectFile();
          result = { errors: [], warnings: [] };
          break;
        case 'Bundle':
          await (await import('@/export/project/bundle')).downloadProjectBundle(ir);
          result = { errors: [], warnings: [] };
          break;
        case 'CSV':
          downloadConditionsCsv(ir);
          result = { errors: [], warnings: [] };
          break;
        case 'Markdown':
          downloadMarkdownSummary(ir);
          result = { errors: [], warnings: [] };
          break;
        default:
          result = { errors: ['Unknown target'], warnings: [] };
      }
      if (target !== 'JSON') {
        addActivity(
          result.errors.length > 0 ? 'error' : result.warnings.length > 0 ? 'warning' : 'success',
          result.errors.length > 0
            ? isJa
              ? `${target} の出力に失敗しました。`
              : `${target} export failed.`
            : result.warnings.length > 0
              ? isJa
                ? `${target} を警告付きで出力しました。`
                : `${target} export completed with warnings.`
              : isJa
                ? `${target} を出力しました。`
                : `${target} export completed.`,
        );
      }
      if (target !== 'JSON') {
        recordExportResult(target, result.errors, result.warnings);
      }
      setLastResult({ target, ...result });
    } catch (e) {
      const errors = [String(e)];
      addActivity(
        'error',
        isJa
          ? `${target} の出力中に例外が発生しました。`
          : `An exception occurred while exporting ${target}.`,
      );
      recordExportResult(target, errors, []);
      setLastResult({ target, errors, warnings: [] });
    }
    setExporting(null);
  };

  const targets = [
    { name: 'OpenSeesPy', desc: isJa ? '構造解析 (Python + CSV)' : 'Structural (Python + CSV)', enabled: ir.solver_targets.find((t) => t.target_name === 'OpenSeesPy')?.enabled ?? true },
    { name: 'DOLFINx', desc: isJa ? '連続体解析 (Gmsh + Python)' : 'Continuum (Gmsh + Python)', enabled: ir.solver_targets.find((t) => t.target_name === 'DOLFINx')?.enabled ?? false },
    { name: 'OpenFOAM', desc: isJa ? '流体解析 (ケースディレクトリ)' : 'CFD (Case directory)', enabled: ir.solver_targets.find((t) => t.target_name === 'OpenFOAM')?.enabled ?? false },
    { name: 'JSON', desc: isJa ? 'プロジェクトファイル (.fem.json)' : 'Project file (.fem.json)', enabled: true },
    { name: 'Bundle', desc: isJa ? 'IR・STL・manifest (.fem.zip)' : 'IR, STL assets, and manifest (.fem.zip)', enabled: true },
    { name: 'CSV', desc: isJa ? '条件一覧CSV' : 'Conditions summary CSV', enabled: true },
    { name: 'Markdown', desc: isJa ? '入力サマリーMarkdown' : 'Input summary Markdown', enabled: true },
  ];
  const coverage = preflightExport(ir, coverageTarget, analysisCaseId || undefined);
  const validationIsStale = validation.validated_revision !== validation.model_revision;
  const selectedAnalysisCase = ir.analysis_cases.find((item) => item.id === analysisCaseId);
  const guidedSteps = [
    { panel: 'geometry', done: ir.geometry.bodies.length > 0, ja: '解析形状', en: 'Analysis geometry' },
    { panel: 'selections', done: ir.named_selections.length > 0 && ir.named_selections.every((item) => item.member_refs.length > 0), ja: '確定Named Selection', en: 'Resolved named selections' },
    { panel: 'materials', done: ir.material_assignments.length > 0, ja: '材料割当', en: 'Material assignments' },
    {
      panel: 'sections',
      done: selectedAnalysisCase?.domain_type !== 'frame' && selectedAnalysisCase?.domain_type !== 'truss'
        ? true
        : ir.section_assignments.length > 0,
      ja: '断面割当',
      en: 'Section assignments',
    },
    {
      panel: 'bc',
      done: ir.boundary_conditions.length > 0,
      ja: '境界条件',
      en: 'Boundary conditions',
    },
    {
      panel: 'loads',
      done: selectedAnalysisCase?.domain_type === 'fluid' || ir.loads.length > 0,
      ja: '荷重・熱入力',
      en: 'Loads / heat input',
    },
    { panel: 'analysis', done: Boolean(selectedAnalysisCase), ja: '解析ケース', en: 'Analysis case' },
    {
      panel: 'validation',
      done: !validationIsStale && errorCount === 0 && coverage.errors.length === 0,
      ja: 'strict検証・coverage',
      en: 'Strict validation / coverage',
    },
  ];

  return (
    <div className="space-y-4">
      {/* Validation summary */}
      <div className="p-3 rounded" style={{ backgroundColor: errorCount > 0 ? 'rgba(244,67,54,0.1)' : 'rgba(76,175,80,0.1)' }}>
        <div className="text-sm font-bold" style={{ color: errorCount > 0 ? 'var(--color-error)' : 'var(--color-success)' }}>
          {validationIsStale
            ? (isJa ? '未検証の変更があります' : 'Changes require validation')
            : errorCount > 0
            ? `${errorCount} ${isJa ? '件のエラー' : 'error(s)'}`
            : (isJa ? '検証OK' : 'Validation OK')}
        </div>
        {errorCount > 0 && (
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
            {isJa ? 'エラーを解消してからエクスポートしてください。' : 'Resolve errors before exporting.'}
          </p>
        )}
      </div>

      <div className="space-y-2 p-3 rounded" style={{ backgroundColor: 'var(--color-bg-input)' }}>
        <label className="block text-xs" htmlFor="export-analysis-case" style={{ color: 'var(--color-text-muted)' }}>
          {isJa ? '解析ケース' : 'Analysis case'}
        </label>
        <select
          id="export-analysis-case"
          value={analysisCaseId}
          onChange={(event) => setRequestedAnalysisCaseId(event.target.value)}
          className="w-full px-2 py-1.5 rounded text-sm"
          style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
        >
          {ir.analysis_cases.length === 0 && <option value="">—</option>}
          {ir.analysis_cases.map((analysisCase) => <option key={analysisCase.id} value={analysisCase.id}>{analysisCase.name}</option>)}
        </select>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-bold" style={{ color: 'var(--color-text-muted)' }}>{isJa ? 'ソルバー有効化' : 'Enabled solvers'}</div>
        {ir.solver_targets.map((target) => (
          <label key={target.target_name} className="flex items-center justify-between px-3 py-2 rounded text-sm" style={{ backgroundColor: 'var(--color-bg-input)' }}>
            <span>{target.target_name} <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>strict</span></span>
            <input
              type="checkbox"
              checked={target.enabled}
              onChange={(event) => setSolverTargetEnabled(target.target_name, event.target.checked)}
            />
          </label>
        ))}
      </div>

      <details className="p-3 rounded" style={{ backgroundColor: 'var(--color-bg-input)' }}>
        <summary className="cursor-pointer text-sm">{isJa ? 'ソルバー対応範囲' : 'Solver capability / coverage'}</summary>
        <select
          aria-label={isJa ? '対応範囲ソルバー' : 'Coverage solver'}
          value={coverageTarget}
          onChange={(event) => setCoverageTarget(event.target.value as SolverTargetName)}
          className="w-full mt-2 px-2 py-1 rounded text-sm"
        >
          {Object.keys(SOLVER_CAPABILITIES).map((target) => <option key={target}>{target}</option>)}
        </select>
        <div className="mt-2 text-xs space-y-1" style={{ color: 'var(--color-text-muted)' }}>
          <div>{isJa ? '消費' : 'Consumed'}: {coverage.coverage?.consumedIds.length ?? 0}</div>
          <div>{isJa ? '除外' : 'Excluded'}: {coverage.coverage?.ignoredIds.length ?? 0}</div>
          {coverage.errors.map((issue) => <div key={`${issue.code}:${issue.targetRef}`} style={{ color: 'var(--color-error)' }}>{issue.message}</div>)}
          {coverage.warnings.map((issue) => <div key={`${issue.code}:${issue.targetRef}`} style={{ color: 'var(--color-warning)' }}>{issue.message}</div>)}
        </div>
      </details>

      <section className="p-3 rounded" style={{ backgroundColor: 'var(--color-bg-input)' }} aria-labelledby="guided-analysis-heading">
        <h3 id="guided-analysis-heading" className="text-sm font-bold mb-2">
          {isJa ? '解析準備チェックリスト' : 'Guided analysis checklist'}
        </h3>
        <div className="space-y-1">
          {guidedSteps.map((step) => (
            <button
              key={step.panel}
              type="button"
              onClick={() => setActivePanel(step.panel)}
              className="w-full flex items-center gap-2 text-left text-xs p-1.5 rounded cursor-pointer"
              style={{ color: step.done ? 'var(--color-success)' : 'var(--color-warning)' }}
            >
              <span aria-hidden="true">{step.done ? '✓' : '○'}</span>
              <span>{isJa ? step.ja : step.en}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Export buttons */}
      <div className="space-y-2">
        {targets.map((t) => (
          <button
            key={t.name}
            onClick={() => handleExport(t.name)}
            disabled={exporting !== null || (['OpenSeesPy', 'DOLFINx', 'OpenFOAM'].includes(t.name) && !t.enabled)}
            className="w-full p-3 rounded text-left transition-colors cursor-pointer disabled:opacity-50"
            style={{
              backgroundColor: 'var(--color-bg-input)',
              border: '1px solid var(--color-border)',
            }}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                  {t.name === 'JSON' ? (isJa ? 'プロジェクト保存' : 'Save Project') : t.name}
                </div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{t.desc}</div>
              </div>
              {exporting === t.name && (
                <span className="text-xs" style={{ color: 'var(--color-accent)' }}>
                  {isJa ? 'エクスポート中...' : 'Exporting...'}
                </span>
              )}
            </div>
          </button>
        ))}
      </div>

      {/* Last result */}
      {lastResult && (
        <div className="p-3 rounded" style={{ backgroundColor: 'var(--color-bg-input)' }}>
          <div className="text-sm font-bold mb-1" style={{ color: lastResult.errors.length > 0 ? 'var(--color-error)' : 'var(--color-success)' }}>
            {lastResult.target}: {lastResult.errors.length > 0 ? (isJa ? '失敗' : 'Failed') : (isJa ? '成功' : 'Success')}
          </div>
          {lastResult.errors.map((e, i) => (
            <div key={i} className="text-xs" style={{ color: 'var(--color-error)' }}>{e}</div>
          ))}
          {lastResult.warnings.map((w, i) => (
            <div key={i} className="text-xs" style={{ color: 'var(--color-warning)' }}>{w}</div>
          ))}
        </div>
      )}
    </div>
  );
}
