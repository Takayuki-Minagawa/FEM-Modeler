import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { solverTargetForProfile, verifyResultImport } from '@/results';
import { parseResultFileAsync } from '@/results/async-import';
import { resultImportExpectations, resultMatchesInput } from '@/core/ir/provenance';
import { ConvergenceStudyForm } from './ConvergenceStudyForm';
import { MeshResultSummary } from './MeshResultSummary';
import { useViewerState } from '@/viewer/view-state';
import { useAppStore } from '@/state/store';
import { buildPhysicsAdvisorReport } from '@/validation/physics-advisor';
import { SelectInput } from './common/SelectInput';

export function ResultsForm() {
  const { i18n } = useTranslation();
  const isJa = i18n.language === 'ja';
  const ir = useAppStore((state) => state.ir);
  const results = ir.results;
  const analysisCases = ir.analysis_cases;
  const removeResult = useAppStore((state) => state.removeResult);
  const fileInput = useRef<HTMLInputElement>(null);
  const pendingImport = useRef<AbortController | null>(null);
  const [importing, setImporting] = useState(false);
  useEffect(() => () => {
    const pending = pendingImport.current; pendingImport.current = null; pending?.abort();
  }, []);
  const [requestedAnalysisCaseId, setRequestedAnalysisCaseId] = useState(() => analysisCases.find((item) => item.active)?.id ?? analysisCases[0]?.id ?? '');
  const [allowMeshVariation, setAllowMeshVariation] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const analysisCaseId = analysisCases.some((item) => item.id === requestedAnalysisCaseId)
    ? requestedAnalysisCaseId
    : analysisCases.find((item) => item.active)?.id ?? analysisCases[0]?.id ?? '';
  const advisor = useMemo(() => buildPhysicsAdvisorReport(ir), [ir]);
  const selectedAnalysisCase = analysisCases.find((item) => item.id === analysisCaseId);
  const solverTarget = selectedAnalysisCase
    ? solverTargetForProfile(selectedAnalysisCase.solver_profile_hint)
    : 'OpenSeesPy';

  const cancelImport = () => {
    const pending = pendingImport.current; pendingImport.current = null; pending?.abort();
    setImporting(false);
    setMessage({ error: false, text: isJa ? '結果取込をキャンセルしました。' : 'Result import cancelled.' });
    if (fileInput.current) fileInput.current.value = '';
  };

  const importFile = async (file: File) => {
    pendingImport.current?.abort();
    const controller = new AbortController();
    pendingImport.current = controller;
    const projectId = useAppStore.getState().ir.meta.project_id;
    setImporting(true); setMessage(null);
    try {
      const parsed = await parseResultFileAsync(file, analysisCaseId, solverTarget, controller.signal);
      if (controller.signal.aborted || pendingImport.current !== controller) return;
      if (!parsed.success || !parsed.result) throw new Error(parsed.error ?? 'Result import failed.');
      // The model can change while a File is read or a Worker is running.
      // Recheck on the main thread immediately before the synchronous store write.
      const latestStore = useAppStore.getState();
      const latest = latestStore.ir;
      if (latest.meta.project_id !== projectId || !latest.analysis_cases.some((item) => item.id === analysisCaseId && solverTargetForProfile(item.solver_profile_hint) === solverTarget)) {
        throw new Error(isJa ? '取込中にプロジェクトまたは解析ケースが変わりました。再度取り込んでください。' : 'The project or analysis case changed during import. Please import again.');
      }
      const response = verifyResultImport(parsed.result, analysisCaseId, solverTarget, { ...resultImportExpectations(latest, solverTarget, analysisCaseId), allowMeshVariation });
      if (!response.success || !response.result) throw new Error(response.error ?? 'Result verification failed.');
      latestStore.addResult(response.result);
      setMessage({ error: false, text: response.warnings[0] ?? (isJa ? '結果を取り込みました。' : 'Result imported.') });
    } catch (error) {
      if (!controller.signal.aborted && pendingImport.current === controller) {
        setMessage({ error: true, text: error instanceof Error ? error.message : String(error) });
      }
    } finally {
      if (pendingImport.current === controller) {
        pendingImport.current = null; setImporting(false);
        if (fileInput.current) fileInput.current.value = '';
      }
    }
  };

  return (
    <div className="space-y-4">
      <div className="p-3 rounded space-y-2" style={{ backgroundColor: 'var(--color-bg-input)' }}>
        <SelectInput
          label={isJa ? '解析ケース' : 'Analysis case'}
          value={analysisCaseId}
          disabled={importing}
          options={[{ value: '', label: '—' }, ...analysisCases.map((item) => ({ value: item.id, label: item.name }))]}
          onChange={setRequestedAnalysisCaseId}
        />
        <div className="flex items-center justify-between gap-2 text-xs">
          <span style={{ color: 'var(--color-text-muted)' }}>{isJa ? 'ソルバー（ケースから決定）' : 'Solver (from case)'}</span>
          <strong>{solverTarget}</strong>
        </div>
        <label className="block text-xs"><input type="checkbox" disabled={importing} checked={allowMeshVariation} onChange={(event) => setAllowMeshVariation(event.target.checked)} /> {isJa ? "収束比較用にメッシュだけ異なる結果を許可" : "Allow mesh variants for convergence comparison"}</label>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,.json"
          disabled={importing}
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importFile(file);
          }}
        />
        <button
          type="button"
          disabled={!analysisCaseId || importing}
          onClick={() => fileInput.current?.click()}
          className="w-full py-2 rounded text-sm cursor-pointer disabled:opacity-40"
          style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}
        >
          {isJa ? '結果CSV / manifest / メッシュJSONを取り込む' : 'Import result CSV / manifest / mesh JSON'}
        </button>
        {importing && <div className="text-xs flex justify-between gap-2"><span role="status">{isJa ? "結果を読み込み・解析中…" : "Reading and processing results…"}</span><button type="button" onClick={cancelImport}>{isJa ? "キャンセル" : "Cancel import"}</button></div>}
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
        const stale = !resultMatchesInput(ir, result);
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
          <MeshResultSummary result={result} ja={isJa} />
          {result.fields.map((field) => (
            <div key={field.id} className="text-xs flex justify-between gap-2">
              <span>{field.name} ({field.location}) {result.mesh && <button type="button" onClick={() => { useViewerState.getState().set({ resultId: result.id, fieldId: field.id, badElementsOnly: false, probe: null }); useViewerState.getState().focusPoints(result.mesh!.nodes.map((node) => node.position)); }}>{isJa ? "表示" : "View"}</button>}</span>
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

      <ConvergenceStudyForm analysisCaseId={analysisCaseId} />

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
