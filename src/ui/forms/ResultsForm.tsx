import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { analyzeThreeMeshConvergence, importResultText, MAX_RESULT_TEXT_BYTES, solverTargetForProfile } from '@/results';
import type { ConvergenceResult } from '@/results';
import { useAppStore } from '@/state/store';
import { buildPhysicsAdvisorReport } from '@/validation/physics-advisor';
import { SelectInput } from './common/SelectInput';
import { UnitInput } from './common/UnitInput';

interface ConvergenceDraft {
  meshSize: number | null;
  qoi: number | null;
}

const INITIAL_CONVERGENCE_DRAFT: ConvergenceDraft[] = [
  { meshSize: null, qoi: null },
  { meshSize: null, qoi: null },
  { meshSize: null, qoi: null },
];

export function ResultsForm() {
  const { i18n } = useTranslation();
  const isJa = i18n.language === 'ja';
  const ir = useAppStore((state) => state.ir);
  const results = ir.results;
  const analysisCases = ir.analysis_cases;
  const addResult = useAppStore((state) => state.addResult);
  const removeResult = useAppStore((state) => state.removeResult);
  const fileInput = useRef<HTMLInputElement>(null);
  const [requestedAnalysisCaseId, setRequestedAnalysisCaseId] = useState(() => analysisCases.find((item) => item.active)?.id ?? analysisCases[0]?.id ?? '');
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [convergenceDraft, setConvergenceDraft] = useState<ConvergenceDraft[]>(INITIAL_CONVERGENCE_DRAFT);
  const [convergenceResult, setConvergenceResult] = useState<ConvergenceResult | null>(null);
  const [convergenceError, setConvergenceError] = useState<string | null>(null);
  const analysisCaseId = analysisCases.some((item) => item.id === requestedAnalysisCaseId)
    ? requestedAnalysisCaseId
    : analysisCases.find((item) => item.active)?.id ?? analysisCases[0]?.id ?? '';
  const advisor = useMemo(() => buildPhysicsAdvisorReport(ir), [ir]);
  const selectedAnalysisCase = analysisCases.find((item) => item.id === analysisCaseId);
  const solverTarget = selectedAnalysisCase
    ? solverTargetForProfile(selectedAnalysisCase.solver_profile_hint)
    : 'OpenSeesPy';

  const importFile = async (file: File) => {
    try {
      if (file.size > MAX_RESULT_TEXT_BYTES) {
        throw new Error(isJa ? '結果ファイルは20 MB以下にしてください。' : 'Result file exceeds the 20 MB safety limit.');
      }
      const response = importResultText(await file.text(), file.name, analysisCaseId, solverTarget, {
        expectedModelRevision: ir.validation.model_revision,
      });
      if (!response.success || !response.result) {
        setMessage({ error: true, text: response.error ?? 'Result import failed.' });
        return;
      }
      addResult(response.result);
      setMessage({
        error: false,
        text: response.warnings[0] ?? (isJa ? '結果を取り込みました。' : 'Result imported.'),
      });
    } catch (error) {
      setMessage({ error: true, text: error instanceof Error ? error.message : String(error) });
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const updateConvergenceDraft = (
    index: number,
    field: keyof ConvergenceDraft,
    value: number | null,
  ) => {
    setConvergenceDraft((current) => current.map((sample, sampleIndex) => (
      sampleIndex === index ? { ...sample, [field]: value } : sample
    )));
  };

  const calculateConvergence = () => {
    try {
      const samples = convergenceDraft.map((sample, index) => {
        if (sample.meshSize === null || sample.qoi === null) {
          throw new Error(isJa ? '3段階すべての h と QoI を入力してください。' : 'Enter h and QoI for all three levels.');
        }
        return {
          label: ['coarse', 'medium', 'fine'][index],
          meshSize: sample.meshSize,
          qoi: sample.qoi,
        };
      });
      setConvergenceResult(analyzeThreeMeshConvergence(samples));
      setConvergenceError(null);
    } catch (error) {
      setConvergenceResult(null);
      setConvergenceError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="space-y-4">
      <div className="p-3 rounded space-y-2" style={{ backgroundColor: 'var(--color-bg-input)' }}>
        <SelectInput
          label={isJa ? '解析ケース' : 'Analysis case'}
          value={analysisCaseId}
          options={[{ value: '', label: '—' }, ...analysisCases.map((item) => ({ value: item.id, label: item.name }))]}
          onChange={setRequestedAnalysisCaseId}
        />
        <div className="flex items-center justify-between gap-2 text-xs">
          <span style={{ color: 'var(--color-text-muted)' }}>{isJa ? 'ソルバー（ケースから決定）' : 'Solver (from case)'}</span>
          <strong>{solverTarget}</strong>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,.json"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importFile(file);
          }}
        />
        <button
          type="button"
          disabled={!analysisCaseId}
          onClick={() => fileInput.current?.click()}
          className="w-full py-2 rounded text-sm cursor-pointer disabled:opacity-40"
          style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}
        >
          {isJa ? '結果CSV / manifestを取り込む' : 'Import result CSV / manifest'}
        </button>
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {isJa ? 'CSVの数値列をResultIRへ変換し、result_manifest.jsonの収束・保存則チェックも取り込みます。' : 'Numeric CSV columns become ResultIR fields; result_manifest.json convergence/conservation checks are also supported.'}
        </p>
      </div>

      {message && (
        <div role="status" className="p-2 rounded text-xs" style={{ color: message.error ? 'var(--color-error)' : 'var(--color-success)', backgroundColor: 'var(--color-bg-input)' }}>
          {message.text}
        </div>
      )}

      {results.map((result) => {
        const importedRevision = result.metadata.imported_for_model_revision;
        const stale = typeof importedRevision === 'number'
          && importedRevision !== ir.validation.model_revision;
        const provenanceVerified = result.metadata.provenance_verified === true;
        return (
        <section key={result.id} className="p-3 rounded space-y-2" style={{ backgroundColor: 'var(--color-bg-input)' }}>
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-bold">{result.source_file_name}</div>
              <div className="text-xs" style={{ color: stale || !provenanceVerified ? 'var(--color-warning)' : 'var(--color-text-muted)' }}>
                {result.solver_target} · {result.status}
                {stale ? ` · ${isJa ? 'モデル変更後の古い結果' : 'stale after model changes'}` : ''}
                {!stale && !provenanceVerified ? ` · ${isJa ? '出所未検証' : 'unverified provenance'}` : ''}
              </div>
            </div>
            <button type="button" onClick={() => removeResult(result.id)} aria-label={isJa ? '結果を削除' : 'Delete result'} style={{ color: 'var(--color-error)' }}>&times;</button>
          </div>
          {result.fields.map((field) => (
            <div key={field.id} className="text-xs flex justify-between gap-2">
              <span>{field.name} ({field.location})</span>
              <span>{field.minimum.toPrecision(5)} – {field.maximum.toPrecision(5)} {field.unit}</span>
            </div>
          ))}
          {result.checks.map((check, index) => (
            <div key={`${check.kind}-${index}`} className="text-xs p-2 rounded" style={{ color: check.status === 'pass' ? 'var(--color-success)' : check.status === 'fail' ? 'var(--color-error)' : 'var(--color-warning)', backgroundColor: 'var(--color-bg-secondary)' }}>
              {check.kind}: {check.status} — {check.message}
            </div>
          ))}
        </section>
        );
      })}

      <section className="p-3 rounded space-y-3" style={{ backgroundColor: 'var(--color-bg-input)' }} aria-labelledby="convergence-heading">
        <div>
          <h3 id="convergence-heading" className="text-sm font-bold">
            {isJa ? '3メッシュ収束性' : 'Three-mesh convergence'}
          </h3>
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
            {isJa ? '粗→中→細の代表寸法 h と同じQoIを入力し、observed order・Richardson外挿・GCIを評価します。' : 'Enter coarse-to-fine h and one consistent QoI to evaluate observed order, Richardson extrapolation, and GCI.'}
          </p>
        </div>
        {convergenceDraft.map((sample, index) => (
          <div key={index} className="grid grid-cols-2 gap-2 p-2 rounded" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
            <div className="col-span-2 text-xs font-bold" style={{ color: 'var(--color-text-secondary)' }}>
              {[isJa ? '粗' : 'Coarse', isJa ? '中' : 'Medium', isJa ? '細' : 'Fine'][index]}
            </div>
            <UnitInput
              label="h"
              value={sample.meshSize}
              unit="m"
              min={0}
              onChange={(value) => updateConvergenceDraft(index, 'meshSize', value)}
            />
            <UnitInput
              label="QoI"
              value={sample.qoi}
              unit="—"
              onChange={(value) => updateConvergenceDraft(index, 'qoi', value)}
            />
          </div>
        ))}
        <button
          type="button"
          onClick={calculateConvergence}
          className="w-full py-2 rounded text-sm cursor-pointer"
          style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}
        >
          {isJa ? '収束性を計算' : 'Calculate convergence'}
        </button>
        {convergenceError && <div role="alert" className="text-xs" style={{ color: 'var(--color-error)' }}>{convergenceError}</div>}
        {convergenceResult && (
          <div role="status" className="space-y-1 text-xs p-2 rounded" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
            <div className="flex justify-between gap-2"><span>observed p</span><strong>{convergenceResult.observedOrder.toPrecision(5)}</strong></div>
            <div className="flex justify-between gap-2"><span>Richardson QoI</span><strong>{convergenceResult.richardsonExtrapolatedQoi.toPrecision(6)}</strong></div>
            <div className="flex justify-between gap-2"><span>fine GCI</span><strong>{convergenceResult.gci.finePercent?.toPrecision(4) ?? '—'} %</strong></div>
            <div className="flex justify-between gap-2"><span>{isJa ? '漸近域判定' : 'Asymptotic check'}</span><strong>{convergenceResult.regime}</strong></div>
          </div>
        )}
      </section>

      <section className="p-3 rounded space-y-2" style={{ backgroundColor: 'var(--color-bg-input)' }} aria-labelledby="advisor-heading">
        <div>
          <h3 id="advisor-heading" className="text-sm font-bold">{isJa ? '物理アドバイザ' : 'Physics advisor'}</h3>
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
            {isJa ? '明示されたIR値だけから細長比・Re・Bi・Foを計算します。' : 'Uses only explicit IR inputs to calculate slenderness, Re, Bi, and Fo.'}
          </p>
        </div>
        {advisor.metrics.length === 0 && advisor.notices.length === 0 && (
          <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{isJa ? '対象となる物理量はありません。' : 'No applicable metrics.'}</div>
        )}
        {advisor.metrics.map((metric) => (
          <details key={metric.id} className="p-2 rounded" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
            <summary className="text-xs cursor-pointer flex justify-between gap-2">
              <span>{metric.symbol}</span>
              <strong style={{ color: metric.status === 'warning' ? 'var(--color-error)' : metric.status === 'caution' ? 'var(--color-warning)' : 'var(--color-success)' }}>
                {metric.value.toPrecision(5)} · {metric.status}
              </strong>
            </summary>
            <p className="text-xs mt-2" style={{ color: 'var(--color-text-secondary)' }}>{metric.interpretation}</p>
            <ul className="text-xs mt-2 space-y-1" style={{ color: 'var(--color-text-muted)' }}>
              {metric.inputs.map((input) => <li key={`${input.name}:${input.sourceRef ?? ''}`}>{input.name}: {input.value.toPrecision(5)} {input.unit}</li>)}
            </ul>
          </details>
        ))}
        {advisor.notices.map((notice) => (
          <div key={`${notice.code}:${notice.metricId ?? ''}`} className="text-xs p-2 rounded" style={{ backgroundColor: 'var(--color-bg-secondary)', color: notice.severity === 'warning' ? 'var(--color-warning)' : 'var(--color-text-muted)' }}>
            {notice.code}: {notice.message}
          </div>
        ))}
      </section>
    </div>
  );
}
