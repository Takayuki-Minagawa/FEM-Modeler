import * as THREE from 'three';
import type { ResultField, ResultIR } from '@/core/ir/types';
import { summarizeMesh } from '@/results/package';
import { deformedNodes, ELEMENT_EDGES, exteriorTriangles, scalarColor, scalarLookup } from './result-data';

/** Geometry and its probe owners are built together to keep displayed values consistent. */
export function buildResultGeometry(result: ResultIR, field: ResultField | undefined, deformationScale: number, badElementsOnly: boolean) {
  if (!result.mesh) return null;
  const mesh = result.mesh;
  const { positions } = deformedNodes(result, deformationScale);
  const values = scalarLookup(field);
  const nodeValues = field?.location === 'node' ? values : new Map<string, number>();
  const allowed = badElementsOnly ? new Set(summarizeMesh(mesh).badElementIds) : undefined;
  const triangles = exteriorTriangles(mesh, allowed, field);
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
  nodes.setAttribute('color', new THREE.Float32BufferAttribute(mesh.nodes.flatMap((node) => scalarColor(nodeValues.get(node.id), field?.minimum ?? 0, field?.maximum ?? 1)), 3));
  return { surface, wire, nodes, triangles, values, nodeValues, positions };
}
