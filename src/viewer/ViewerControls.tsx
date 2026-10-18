import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/state/store';
import { materialOverlays } from './material-data';
import { useViewerState } from './view-state';
import { geometryFocusPoints } from './focus-bounds';

export function ViewerControls() {
  const { t } = useTranslation();
  const ir = useAppStore((state) => state.ir);
  const selectedIds = useAppStore((state) => state.selectedEntityIds);
  const allPoints = useMemo(() => geometryFocusPoints({ geometry: ir.geometry, assets: ir.assets }), [ir.geometry, ir.assets]);
  const selectedPoints = useMemo(() => geometryFocusPoints({ geometry: ir.geometry, assets: ir.assets }, selectedIds), [ir.geometry, ir.assets, selectedIds]);
  const state = useViewerState();
  const overlays = useMemo(() => state.showMaterials ? materialOverlays(ir) : [], [ir, state.showMaterials]);
  return <div className="absolute top-2 left-2 z-10 max-w-sm rounded p-2 text-xs space-y-2 max-h-[45%] overflow-auto" style={{ backgroundColor: 'var(--color-bg-panel)', color: 'var(--color-text)' }}>
    <div role="group" aria-label={t('viewerControls.controls')} className="flex flex-wrap gap-2">
      <button type="button" disabled={!allPoints.length} onClick={() => state.focusPoints(allPoints)}>{t('viewerControls.fitAll')}</button>
      <button type="button" disabled={!selectedPoints.length} onClick={() => state.focusPoints(selectedPoints)}>{t('viewerControls.fitSelected')}</button>
      {(['front', 'top', 'right', 'isometric'] as const).map((direction) => <button key={direction} type="button" disabled={!allPoints.length} onClick={() => state.focusPoints(selectedPoints.length ? selectedPoints : allPoints, direction)}>{t(`viewerControls.${direction}`)}</button>)}
    </div>
    <label><input type="checkbox" checked={state.showMaterials} onChange={(event) => state.set({ showMaterials: event.target.checked })} /> {t('viewerControls.materials')}</label>
    {state.showMaterials && <>
      <p>{t('viewerControls.materialsHelp')}</p>
      {overlays.length === 0 && <p>{t('viewerControls.noMaterials')}</p>}
      {overlays.map((item) => <div key={item.id} className="flex gap-2 justify-between">
        <span style={{ color: item.color }}>{item.name} · {item.selectionName}</span>
        <button type="button" aria-label={t('workflow.targetZoom', { name: `${item.name} (${item.id})` })} disabled={!item.target.points.length} onClick={() => state.focusPoints(item.target.points)}>{t('viewerControls.zoom')}</button>
      </div>)}
    </>}
  </div>;
}
