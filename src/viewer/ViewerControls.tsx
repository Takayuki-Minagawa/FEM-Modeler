import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/state/store';
import { resultMatchesInput } from '@/core/ir/provenance';
import { conditionOverlays } from './condition-data';
import { deformedNodes } from './result-data';
import { useViewerState } from './view-state';

export function ViewerControls() {
  const { i18n } = useTranslation(); const ja = i18n.language === 'ja';
  const ir = useAppStore((state) => state.ir);
  const activeCase = ir.analysis_cases.find((item) => item.active);
  const state = useViewerState();
  const result = ir.results.find((item) => item.id === state.resultId);
  const field = result?.fields.find((item) => item.id === state.fieldId);
  const overlays = useMemo(() => state.showConditions || state.showMaterials ? conditionOverlays(ir) : [], [ir, state.showConditions, state.showMaterials]);
  const deformationScale = state.deformationScale;
  const deformation = result ? deformedNodes(result, deformationScale) : null;
  return <div className="absolute top-2 left-2 z-10 max-w-sm rounded p-2 text-xs space-y-2 max-h-[45%] overflow-auto" style={{ backgroundColor: 'var(--color-bg-panel)', color: 'var(--color-text)' }}>
    <div className="flex flex-wrap gap-3">
      <label><input type="checkbox" checked={state.showConditions} onChange={(e) => state.set({ showConditions: e.target.checked, resultId: '' })} /> {ja ? '条件表示' : 'Conditions'}</label>
      <label><input type="checkbox" checked={state.showMaterials} onChange={(e) => state.set({ showMaterials: e.target.checked, resultId: '' })} /> {ja ? '材料割当' : 'Materials'}</label>
    </div>
    {(state.showConditions || state.showMaterials) && <>
      <label>{ja ? '表示ケース' : 'Visible case'} <select aria-label={ja ? '表示ケース' : 'Visible case'} value={activeCase?.id ?? ''} onChange={(e) => useAppStore.getState().setActiveAnalysisCase(e.target.value)}><option value="">—</option>{ir.analysis_cases.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <p>{ja ? '選択ケースの参加条件のみ表示。矢印の長さは模式表示、値はSI。青:拘束、橙:荷重。' : 'Only participating conditions are shown. Arrow lengths are symbolic; values are SI. Blue: constraints, orange: loads.'}</p>
      {overlays.filter((item) => item.kind === 'material' ? state.showMaterials : state.showConditions).map((item) => <div key={item.id} className="flex gap-2 justify-between"><span title={item.detail} style={{ color: item.color }}>{item.name} · {item.detail}</span><button type="button" disabled={!item.target.points.length} onClick={() => state.focusPoints(item.target.points)}>{ja ? '対象へ' : 'Zoom'}</button></div>)}
    </>}
    {result && <>
      <div className="flex gap-2"><strong>{result.source_file_name}</strong><button type="button" onClick={() => state.set({ resultId: '', probe: null })}>{ja ? '結果を閉じる' : 'Close result'}</button></div>
      <p style={{ color: resultMatchesInput(ir, result) ? 'var(--color-success)' : 'var(--color-warning)' }}>{resultMatchesInput(ir, result) ? (ja ? '現在の入力と照合済み' : 'Matches current input') : (ja ? '古い結果または出所未検証 — 取込メッシュ上に表示' : 'Stale or unverified — displayed on the imported mesh')}</p>
      {field && <><div style={{ height: 8, background: 'linear-gradient(to right, rgb(0,51,255), rgb(128,217,128), rgb(255,51,0))' }} /><div className="flex justify-between"><span>{field.minimum.toPrecision(5)}</span><span>{field.name} [{field.unit || '—'}]</span><span>{field.maximum.toPrecision(5)}</span></div></>}
      <p>{ja ? '灰:欠損値。クリックで節点/要素をprobe。' : 'Gray: missing value. Click to probe a node or element.'}</p>
      {deformation?.available && <label>{ja ? '変形倍率' : 'Deformation scale'} <input aria-label={ja ? '変形倍率' : 'Deformation scale'} type="number" min={0} max={1e9} value={state.deformationScale} className="w-24" onChange={(e) => { const value = Number(e.target.value); if (Number.isFinite(value) && value >= 0 && value <= 1e9) state.set({ deformationScale: value, probe: null }); }} /> {deformation.missingIds.length > 0 ? `${deformation.missingIds.length} missing` : ''}</label>}
      {state.probe && <div role="status">ID {state.probe.id} · ({state.probe.position.map((v) => v.toPrecision(5)).join(', ')}) m · {state.probe.value?.toPrecision(6) ?? 'missing'} {state.probe.unit}</div>}
    </>}
  </div>;
}
