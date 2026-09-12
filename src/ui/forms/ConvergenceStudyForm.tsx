import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/state/store';
import { generateId } from '@/core/ir/id-generator';
import { analyzeThreeMeshConvergence } from '@/results/convergence';
import { convergenceStudyMarkdown, convergenceStudySchema, studyFromResults } from '@/results/studies';
import type { ConvergenceStudy } from '@/results/studies';
import { UnitInput } from './common/UnitInput';
import { SelectInput } from './common/SelectInput';

export function ConvergenceStudyForm({ analysisCaseId }: { analysisCaseId: string }) {
  const { i18n } = useTranslation(); const ja = i18n.language === 'ja';
  const ir = useAppStore((state) => state.ir);
  const [mode, setMode] = useState('results');
  const [ids, setIds] = useState(['', '', '']);
  const [fieldName, setFieldName] = useState('');
  const [unit, setUnit] = useState('');
  const [location, setLocation] = useState('');
  const [reduction, setReduction] = useState<'point' | 'minimum' | 'maximum'>('point');
  const [samples, setSamples] = useState([{ meshSize: null as number | null, qoi: null as number | null }, { meshSize: null as number | null, qoi: null as number | null }, { meshSize: null as number | null, qoi: null as number | null }]);
  const [error, setError] = useState('');
  const available = ir.results.filter((result) => result.analysis_case_id === analysisCaseId);
  const selectedFirst = available.find((result) => result.id === ids[0]);
  const fieldOptions = selectedFirst?.fields.filter((field) => field.component_names.length === 1) ?? [];
  const field = fieldOptions.find((item) => item.name === fieldName);
  const saveStudy = () => {
    try {
      const latest = useAppStore.getState();
      let study: ConvergenceStudy;
      if (mode === 'results') {
        const chosen = ids.map((id) => latest.ir.results.find((result) => result.id === id));
        if (chosen.some((result) => !result)) throw new Error(ja ? '3結果を選択してください。' : 'Select three results.');
        const position = location.split(',').map((s) => Number(s.trim()));
        if (reduction === 'point' && (position.length !== 3 || location.trim() === '' || position.some((v) => !Number.isFinite(v)))) throw new Error('Enter x, y, z in metres.');
        study = studyFromResults(chosen.filter((result) => result !== undefined), { fieldName, unit: field?.unit ?? '', reduction, position: position as [number, number, number] });
      } else {
        study = convergenceStudySchema.parse({ id: generateId('study'), name: `${fieldName} convergence`, created_at: new Date().toISOString(), analysis_case_id: analysisCaseId,
          qoi_definition: fieldName, unit, evaluation_location: location, provenance: 'manual_unverified', notes: ja ? '手入力:入力条件の一致は未検証。' : 'Manual entry: input compatibility is unverified.', samples });
        analyzeThreeMeshConvergence(study.samples);
      }
      latest.mutateArtifact('Save convergence study', (draft) => { draft.convergence_studies.push(study); });
      setError('');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return <section className="p-3 rounded space-y-3" style={{ backgroundColor: 'var(--color-bg-input)' }}>
    <h3 className="text-sm font-bold">{ja ? '3メッシュ収束性・保存レポート' : 'Three-mesh convergence studies'}</h3>
    <SelectInput label={ja ? '入力元' : 'Source'} value={mode} options={[{ value: 'results', label: ja ? '3結果から比較' : 'Compare three results' }, { value: 'manual', label: ja ? '手入力（未検証）' : 'Manual (unverified)' }]} onChange={setMode} />
    {mode === 'results' ? <>
      <p className="text-xs">{ja ? 'メッシュ以外の入力指紋、量、単位、評価位置の一致を検査します。hの大きい順に比較します。' : 'Checks mesh-independent input, field, unit, and evaluation location. Results are sorted by decreasing h.'}</p>
      {ids.map((id, index) => <SelectInput key={index} label={`${ja ? '結果' : 'Result'} ${index + 1}`} value={id} options={[{ value: '', label: '—' }, ...available.map((result) => ({ value: result.id, label: `${result.source_file_name} · h=${result.mesh?.representative_size ?? result.metadata.representative_mesh_size ?? '?'}` }))]} onChange={(value) => setIds(ids.map((id, i) => i === index ? value : id))} />)}
      <SelectInput label="QoI" value={fieldName} options={[{ value: '', label: '—' }, ...fieldOptions.map((field) => ({ value: field.name, label: `${field.name} [${field.unit}]` }))]} onChange={setFieldName} />
      <SelectInput label={ja ? '評価方法' : 'Evaluation'} value={reduction} options={[{ value: 'point', label: ja ? '同じ座標の節点値' : 'Node at same coordinates' }, { value: 'minimum', label: ja ? '全体最小値' : 'Global minimum' }, { value: 'maximum', label: ja ? '全体最大値' : 'Global maximum' }]} onChange={(value) => setReduction(value as typeof reduction)} />
      {reduction === 'point' && <label className="text-xs block">x, y, z [m]<input aria-label="QoI coordinates" className="w-full" value={location} placeholder="0, 0, 0" onChange={(e) => setLocation(e.target.value)} /></label>}
    </> : <>
      <label className="text-xs block">QoI<input aria-label="Manual QoI definition" className="w-full" value={fieldName} onChange={(e) => setFieldName(e.target.value)} /></label>
      <label className="text-xs block">{ja ? '単位' : 'Unit'}<input aria-label="Manual QoI unit" className="w-full" value={unit} onChange={(e) => setUnit(e.target.value)} /></label>
      <label className="text-xs block">{ja ? '評価位置・定義' : 'Evaluation location / definition'}<input aria-label="Manual QoI location" className="w-full" value={location} onChange={(e) => setLocation(e.target.value)} /></label>
      {samples.map((sample, index) => <div key={index} className="space-y-1"><strong className="text-xs">{['Coarse', 'Medium', 'Fine'][index]}</strong><UnitInput label="h" value={sample.meshSize} unit="m" min={0} onChange={(value) => setSamples(samples.map((sample, i) => i === index ? { ...sample, meshSize: value } : sample))} /><UnitInput label="QoI" value={sample.qoi} unit={unit} onChange={(value) => setSamples(samples.map((sample, i) => i === index ? { ...sample, qoi: value } : sample))} /></div>)}
    </>}
    <button type="button" disabled={!analysisCaseId} className="w-full py-2 rounded text-sm" style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }} onClick={saveStudy}>{ja ? '計算して保存' : 'Calculate and save'}</button>
    {error && <div role="alert" className="text-xs" style={{ color: 'var(--color-error)' }}>{error}</div>}
    {ir.convergence_studies.filter((study) => study.analysis_case_id === analysisCaseId).map((study) => <SavedStudy key={study.id} study={study} ja={ja} />)}
  </section>;
}
function SavedStudy({ study, ja }: { study: ConvergenceStudy; ja: boolean }) {
  let report: string;
  try { report = convergenceStudyMarkdown(study); } catch (e) { return <p role="alert">{String(e)}</p>; }
  const analysis = analyzeThreeMeshConvergence(study.samples);
  return <details className="text-xs p-2 rounded" style={{ backgroundColor: 'var(--color-bg-secondary)' }} open>
    <summary>{study.name} · {study.provenance === 'manual_unverified' ? (ja ? '手入力・未検証' : 'Manual / unverified') : (ja ? '結果照合済み' : 'Verified results')}</summary>
    <div>{study.evaluation_location} · [{study.unit}]</div>
    <table className="w-full"><thead><tr><th>h [m]</th><th>QoI</th></tr></thead><tbody>{study.samples.map((sample, i) => <tr key={i}><td>{sample.meshSize}</td><td>{sample.qoi}</td></tr>)}</tbody></table>
    <p>p = {analysis.observedOrder.toPrecision(5)} · GCI = {analysis.gci.finePercent?.toPrecision(5) ?? '—'} % · {analysis.regime}</p>
    <button type="button" onClick={() => {
      const url = URL.createObjectURL(new Blob([report], { type: 'text/markdown;charset=utf-8' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `convergence-${study.id}.md`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
    }}>{ja ? 'Markdownを保存' : 'Download Markdown'}</button>
    <button type="button" className="ml-3" onClick={() => useAppStore.getState().mutateArtifact('Delete convergence study', (ir) => { ir.convergence_studies = ir.convergence_studies.filter((item) => item.id !== study.id); })}>{ja ? '削除' : 'Delete'}</button>
  </details>;
}
