import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useAppStore } from '@/state/store';
import { useViewerState } from './view-state';
import { deformedNodes, ELEMENT_EDGES, exteriorTriangles, scalarColor, scalarLookup } from './result-data';
import { summarizeMesh } from '@/results/package';

export function ResultOverlay() {
  const results = useAppStore((state) => state.ir.results);
  const { resultId, fieldId, deformationScale, badElementsOnly, set } = useViewerState();
  const result = results.find((item) => item.id === resultId);
  const field = result?.fields.find((item) => item.id === fieldId);
  const data = useMemo(() => {
    if (!result?.mesh) return null;
    const mesh = result.mesh;
    const { positions } = deformedNodes(result, deformationScale);
    const values = scalarLookup(field);
    const allowed = badElementsOnly ? new Set(summarizeMesh(mesh).badElementIds) : undefined;
    const triangles = exteriorTriangles(mesh, allowed);
    const p: number[] = [], colors: number[] = [], lines: number[] = [], lineColors: number[] = [];
    for (const triangle of triangles) for (const id of triangle.nodes) {
      p.push(...positions.get(id)!);
      colors.push(...scalarColor(values.get(field?.location === 'node' ? id : triangle.elementId), field?.minimum ?? 0, field?.maximum ?? 1));
    }
    for (const element of mesh.elements) {
      if (allowed && !allowed.has(element.id)) continue;
      for (const pair of ELEMENT_EDGES[element.type]) for (const index of pair) {
        const id = element.node_ids[index];
        lines.push(...positions.get(id)!);
        lineColors.push(...(element.type === 'line2' && field ? scalarColor(values.get(field.location === 'node' ? id : element.id), field.minimum, field.maximum) : [0.2, 0.3, 0.4]));
      }
    }
    const surface = new THREE.BufferGeometry();
    surface.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    surface.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); surface.computeVertexNormals();
    const wire = new THREE.BufferGeometry();
    wire.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    wire.setAttribute('color', new THREE.Float32BufferAttribute(lineColors, 3));
    const nodes = new THREE.BufferGeometry();
    nodes.setAttribute('position', new THREE.Float32BufferAttribute(mesh.nodes.flatMap((node) => positions.get(node.id)!), 3));
    nodes.setAttribute('color', new THREE.Float32BufferAttribute(mesh.nodes.flatMap((node) => scalarColor(values.get(node.id), field?.minimum ?? 0, field?.maximum ?? 1)), 3));
    return { surface, wire, nodes, triangles, values, positions };
  }, [result, field, deformationScale, badElementsOnly]);
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
      set({ probe: { id: node.id, position: node.position, value: field?.location === 'node' ? data.values.get(node.id) ?? null : null, unit: field?.unit ?? '' } });
    }}><pointsMaterial size={5} sizeAttenuation={false} vertexColors depthTest={false} /></points>}
  </group>;
}
