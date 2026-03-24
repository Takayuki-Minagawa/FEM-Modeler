import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/state/store';
import { downloadOpenSeesPyZip } from '@/export/openseespy/exporter';
import { downloadDOLFINxZip } from '@/export/dolfinx/exporter';
import { downloadOpenFOAMZip } from '@/export/openfoam/exporter';
import { downloadConditionsCsv } from '@/export/project/csv-export';
import { downloadMarkdownSummary } from '@/export/project/markdown-summary';
import { useAppContext } from '@/hooks/useAppContext';

export function ExportForm() {
  const { i18n } = useTranslation();
  const isJa = i18n.language === 'ja';
  const { addActivity, saveProjectFile, recordExportResult } = useAppContext();
  const ir = useAppStore((s) => s.ir);
  const validation = useAppStore((s) => s.ir.validation);
  const runValidation = useAppStore((s) => s.runValidation);

  const [exporting, setExporting] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ target: string; errors: string[]; warnings: string[] } | null>(null);

  const errorCount = validation.summary.error_count;

  const handleExport = async (target: string) => {
    runValidation();

    // Block solver exports when validation errors exist
    const solverTargets = ['OpenSeesPy', 'DOLFINx', 'OpenFOAM'];
    if (solverTargets.includes(target)) {
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
          result = await downloadOpenSeesPyZip(ir);
          break;
        case 'DOLFINx':
          result = await downloadDOLFINxZip(ir);
          break;
        case 'OpenFOAM':
          result = await downloadOpenFOAMZip(ir);
          break;
        case 'JSON':
          saveProjectFile();
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
    { name: 'CSV', desc: isJa ? '条件一覧CSV' : 'Conditions summary CSV', enabled: true },
    { name: 'Markdown', desc: isJa ? '入力サマリーMarkdown' : 'Input summary Markdown', enabled: true },
  ];

  return (
    <div className="space-y-4">
      {/* Validation summary */}
      <div className="p-3 rounded" style={{ backgroundColor: errorCount > 0 ? 'rgba(244,67,54,0.1)' : 'rgba(76,175,80,0.1)' }}>
        <div className="text-sm font-bold" style={{ color: errorCount > 0 ? 'var(--color-error)' : 'var(--color-success)' }}>
          {errorCount > 0
            ? `${errorCount} ${isJa ? '件のエラー' : 'error(s)'}`
            : (isJa ? '検証OK' : 'Validation OK')}
        </div>
        {errorCount > 0 && (
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
            {isJa ? 'エラーを解消してからエクスポートしてください。' : 'Resolve errors before exporting.'}
          </p>
        )}
      </div>

      {/* Export buttons */}
      <div className="space-y-2">
        {targets.map((t) => (
          <button
            key={t.name}
            onClick={() => handleExport(t.name)}
            disabled={exporting !== null}
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
