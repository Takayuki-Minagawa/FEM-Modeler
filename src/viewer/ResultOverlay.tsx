import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useAppStore } from '@/state/store';
import { useViewerState } from './view-state';
import { buildResultGeometry } from './result-geometry';

export function ResultOverlay() {
  const results = useAppStore((state) => state.ir.results);
  const { resultId, fieldId, deformationScale, badElementsOnly, set } = useViewerState();
  const result = results.find((item) => item.id === resultId);
  const field = result?.fields.find((item) => item.id === fieldId);
  const data = useMemo(() => result ? buildResultGeometry(result, field, deformationScale, badElementsOnly) : null, [result, field, deformationScale, badElementsOnly]);
  useEffect(() => () => { data?.surface.dispose(); data?.wire.dispose(); data?.nodes.dispose(); }, [data]);
  if (!data || !result?.mesh) return null;
  const mesh = result.mesh;
  return <group>
    <mesh geometry={data.surface} onClick={(event) => {
      event.stopPropagation();
      const triangle = data.triangles[event.faceIndex ?? -1];
      if (!triangle) return;
      if (field?.location === 'node') {
        const node = triangle.nodes.map((id) => mesh.nodes.find((node) => node.id === id)!).sort((a, b) => new THREE.Vector3(...data.positions.get(a.id)!).distanceToSquared(event.point) - new THREE.Vector3(...data.positions.get(b.id)!).distanceToSquared(event.point))[0];
        set({ probe: { id: node.id, position: node.position, value: data.values.get(node.id) ?? null, unit: field.unit } });
      } else set({ probe: { id: triangle.elementId, position: [event.point.x, event.point.y, event.point.z], value: data.values.get(triangle.elementId) ?? null, unit: field?.unit ?? '' } });
    }}><meshStandardMaterial vertexColors side={THREE.DoubleSide} roughness={0.9} /></mesh>
    <lineSegments geometry={data.wire}><lineBasicMaterial vertexColors /></lineSegments>
    {!badElementsOnly && <points geometry={data.nodes} onClick={(event) => {
      event.stopPropagation(); const node = mesh.nodes[event.index ?? -1]; if (!node) return;
      set({ probe: { id: node.id, position: node.position, value: data.nodeValues.get(node.id) ?? null, unit: field?.location === 'node' ? field.unit : '' } });
    }}><pointsMaterial size={5} sizeAttenuation={false} vertexColors depthTest={false} /></points>}
  </group>;
}
