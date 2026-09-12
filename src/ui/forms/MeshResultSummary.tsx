import { useMemo } from 'react';
import type { ResultIR } from '@/core/ir/types';
import { summarizeMesh } from '@/results/package';
import { useViewerState } from '@/viewer/view-state';

export function MeshResultSummary({ result, ja }: { result: ResultIR; ja: boolean }) {
  const summary = useMemo(() => result.mesh ? summarizeMesh(result.mesh) : null, [result.mesh]);
  if (!summary || !result.mesh) return null;
  return <div className="text-xs space-y-2">
    <p>{result.mesh.source.generator} · {summary.nodeCount} {ja ? '節点' : 'nodes'} / {summary.elementCount} {ja ? '要素' : 'elements'} · h={result.mesh.representative_size ?? '—'} m</p>
    <p>{ja ? '境界tag（要素件数）' : 'Boundary tags (element counts)'}: {Object.entries(summary.tags).map(([tag, count]) => `${tag}: ${count}`).join(', ') || '—'}</p>
    {summary.quality.map((metric) => <details key={metric.name}><summary>{metric.name}: {metric.minimum?.toPrecision(5) ?? '—'} – {metric.maximum?.toPrecision(5) ?? '—'} {metric.unit} · {metric.badCount} {ja ? '不良' : 'bad'}</summary>
      <p>{metric.definition}</p><p>{ja ? '判定範囲' : 'Accepted range'}: {metric.bad_below ?? '−∞'} – {metric.bad_above ?? '+∞'}</p>
      <div className="flex items-end gap-1 h-12" aria-label={`${metric.name} histogram`}>{metric.bins.map((count, index) => <div key={index} className="flex-1 text-center" style={{ backgroundColor: 'var(--color-accent)', color: '#fff', height: `${Math.max(10, count / Math.max(1, ...metric.bins) * 100)}%` }} title={`${index + 1}/5: ${count}`}>{count}</div>)}</div><p>{ja ? '最小〜最大を5等分した分布' : 'Five equal-width bins from minimum to maximum'}</p>
    </details>)}
    <div className="flex flex-wrap gap-3">
      <button type="button" onClick={() => { useViewerState.getState().set({ resultId: result.id, fieldId: result.fields[0]?.id ?? '', badElementsOnly: false, probe: null }); useViewerState.getState().focusPoints(result.mesh!.nodes.map((node) => node.position)); }}>{ja ? '3D表示' : 'View in 3D'}</button>
      <button type="button" disabled={!summary.badElementIds.length} onClick={() => { useViewerState.getState().set({ resultId: result.id, fieldId: '', badElementsOnly: true, probe: null }); const nodes = new Set(result.mesh!.elements.filter((element) => summary.badElementIds.includes(element.id)).flatMap((element) => element.node_ids)); useViewerState.getState().focusPoints(result.mesh!.nodes.filter((node) => nodes.has(node.id)).map((node) => node.position)); }}>{ja ? `不良要素を表示 (${summary.badElementIds.length})` : `Show bad elements (${summary.badElementIds.length})`}</button>
    </div>
  </div>;
}
