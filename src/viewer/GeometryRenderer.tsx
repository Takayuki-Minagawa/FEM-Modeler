import { useAppStore } from '@/state/store';
import * as THREE from 'three';
import { useMemo } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { generateShape } from '@/geometry/primitives/generators';
import type { AnyShapeParams } from '@/geometry/primitives/types';
import { getSTLGeometry, restoreSTLGeometry } from '@/geometry/import/stl-geometry-cache';
import { toRadiansTuple } from '@/geometry/transforms';
import type { GeometryAsset } from '@/core/ir/types';
import type { GeometryEdge, GeometryVertex } from '@/core/ir/types';
import type { PickFilterType } from '@/state/store';

export function GeometryRenderer() {
  const bodies = useAppStore((s) => s.ir.geometry.bodies);
  const assets = useAppStore((s) => s.ir.assets);
  const faces = useAppStore((s) => s.ir.geometry.faces);
  const edges = useAppStore((s) => s.ir.geometry.edges);
  const vertices = useAppStore((s) => s.ir.geometry.vertices);
  const pickFilter = useAppStore((s) => s.pickFilter);
  const selectedIds = useAppStore((s) => s.selectedEntityIds);
  const hoveredId = useAppStore((s) => s.hoveredEntityId);
  const setSelectedEntities = useAppStore((s) => s.setSelectedEntities);
  const toggleEntitySelection = useAppStore((s) => s.toggleEntitySelection);
  const setHoveredEntity = useAppStore((s) => s.setHoveredEntity);

  return (
    <group>
      {bodies.map((body) => {
        if (!body.visible) return null;
        const bodyFaces = faces.filter((item) => item.body_id === body.id);
        const bodyEdges = edges.filter((item) => item.body_id === body.id);
        const bodyVertices = vertices.filter((item) => item.body_id === body.id);
        const childIds = new Set([...bodyFaces, ...bodyEdges, ...bodyVertices].map((item) => item.id));
        const isSelected = selectedIds.includes(body.id) || selectedIds.some((id) => childIds.has(id));
        const isHovered = hoveredId === body.id;
        const isLineModel = body.category === 'beam_region';

        const selectEntity = (id: string, e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          if (e.nativeEvent.shiftKey || e.nativeEvent.ctrlKey || e.nativeEvent.metaKey) {
            toggleEntitySelection(id);
          } else {
            setSelectedEntities([id]);
          }
        };
        const handleBodyClick = (e: ThreeEvent<MouseEvent>) => {
          if (pickFilter === 'body') selectEntity(body.id, e);
        };
        const handleSolidClick = (e: ThreeEvent<MouseEvent>) => {
          if (pickFilter === 'body') {
            selectEntity(body.id, e);
            return;
          }
          if (pickFilter !== 'face') return;
          const triangleIndex = e.faceIndex;
          let face = triangleIndex == null
            ? undefined
            : bodyFaces.find((item) => item.triangle_indices.includes(triangleIndex));
          if (!face && e.face) {
            const normal = e.face.normal;
            const scored = bodyFaces
              .filter((item) => item.normal)
              .map((item) => ({ item, score: item.normal![0] * normal.x + item.normal![1] * normal.y + item.normal![2] * normal.z }))
              .sort((left, right) => right.score - left.score);
            if (scored[0]?.score >= 0.9 && (scored[1] === undefined || scored[0].score - scored[1].score > 1e-6)) {
              face = scored[0].item;
            }
            const shapeType = String(body.metadata.shapeType ?? '');
            if (!face && shapeType === 'cylinder' && Math.abs(normal.y) < 0.9) {
              face = bodyFaces.find((item) => item.name === 'side');
            }
            if (!face && (shapeType === 'pipe' || shapeType === 'plateWithHole')) {
              const localPoint = e.object.worldToLocal(e.point.clone());
              if (shapeType === 'pipe' && Math.abs(normal.y) < 0.9) {
                const radius = Math.hypot(localPoint.x, localPoint.z);
                const outerRadius = Number(body.metadata.outerRadius);
                const innerRadius = Number(body.metadata.innerRadius);
                if (Number.isFinite(outerRadius) && Number.isFinite(innerRadius)) {
                  face = bodyFaces.find((item) => item.name === (
                    Math.abs(radius - outerRadius) <= Math.abs(radius - innerRadius)
                      ? 'outer_surface'
                      : 'inner_surface'
                  ));
                }
              }
              if (shapeType === 'plateWithHole' && Math.abs(normal.y) < 0.9) {
                const width = Number(body.metadata.width);
                const depth = Number(body.metadata.depth);
                const holeRadius = Number(body.metadata.holeRadius);
                const distances = [
                  ['hole_surface', Math.abs(Math.hypot(localPoint.x, localPoint.z) - holeRadius)],
                  ['right', Math.abs(localPoint.x - width / 2)],
                  ['left', Math.abs(localPoint.x + width / 2)],
                  ['front', Math.abs(localPoint.z - depth / 2)],
                  ['back', Math.abs(localPoint.z + depth / 2)],
                ] as const;
                const nearest = distances
                  .filter(([, distance]) => Number.isFinite(distance))
                  .sort((left, right) => left[1] - right[1])[0];
                const tolerance = Math.max(width, depth, holeRadius, 1) * 1e-5;
                if (nearest && nearest[1] <= tolerance) {
                  face = bodyFaces.find((item) => item.name === nearest[0]);
                }
              }
            }
          }
          if (face) selectEntity(face.id, e);
        };

        if (isLineModel) {
          return (
            <LineMesh
              key={body.id}
              metadata={body.metadata}
              position={body.transform.position}
              rotation={body.transform.rotation}
              scale={body.transform.scale}
              color={body.color}
              isSelected={isSelected}
              isHovered={isHovered}
              onClick={handleBodyClick}
              onHover={(h) => setHoveredEntity(h ? body.id : null)}
              topologyEdges={bodyEdges}
              topologyVertices={bodyVertices}
              pickFilter={pickFilter}
              selectedIds={selectedIds}
              onSelect={selectEntity}
            />
          );
        }

        return (
          <SolidMesh
            key={body.id}
            bodyId={body.id}
            asset={body.asset_ref ? assets.find((item) => item.id === body.asset_ref) : undefined}
            metadata={body.metadata}
            position={body.transform.position}
            rotation={body.transform.rotation}
            scale={body.transform.scale}
            color={body.color}
            isSelected={isSelected}
            isHovered={isHovered}
            onClick={handleSolidClick}
            onHover={(h) => setHoveredEntity(h ? body.id : null)}
            topologyEdges={bodyEdges}
            topologyVertices={bodyVertices}
            pickFilter={pickFilter}
            selectedIds={selectedIds}
            onSelect={selectEntity}
          />
        );
      })}

      {/* Click on empty space to deselect */}
      <mesh
        visible={false}
        position={[0, 0, 0]}
        onClick={() => setSelectedEntities([])}
      >
        <planeGeometry args={[1000, 1000]} />
      </mesh>
    </group>
  );
}

interface SolidMeshProps {
  bodyId: string;
  asset?: GeometryAsset;
  metadata: Record<string, unknown>;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  color: string;
  isSelected: boolean;
  isHovered: boolean;
  onClick: (e: ThreeEvent<MouseEvent>) => void;
  onHover: (hovered: boolean) => void;
  topologyEdges: GeometryEdge[];
  topologyVertices: GeometryVertex[];
  pickFilter: PickFilterType;
  selectedIds: string[];
  onSelect: (id: string, event: ThreeEvent<MouseEvent>) => void;
}

function SolidMesh({ bodyId, asset, metadata, position, rotation, scale, color, isSelected, isHovered, onClick, onHover, topologyEdges, topologyVertices, pickFilter, selectedIds, onSelect }: SolidMeshProps) {
  const usesSharedSTLGeometry = metadata.shapeType === 'imported_stl';
  const geometry = useMemo(() => {
    try {
      const params = metadata as AnyShapeParams;
      if (!params.shapeType) return new THREE.BufferGeometry();
      // Use cached geometry for imported STL bodies
      if (params.shapeType === 'imported_stl') {
        const cached = getSTLGeometry(bodyId);
        if (cached) return cached;
        if (asset) return restoreSTLGeometry(bodyId, asset);
        console.error(`Imported STL body ${bodyId} has no persisted asset.`);
        return new THREE.BufferGeometry();
      }
      const result = generateShape(params);
      return result.threeGeometry;
    } catch (e) {
      console.error('Failed to generate solid geometry:', e);
      return new THREE.BufferGeometry();
    }
  }, [asset, bodyId, metadata]);

  const edgesGeometry = useMemo(() => new THREE.EdgesGeometry(geometry), [geometry]);

  const displayColor = isSelected
    ? '#4a90d9'
    : isHovered
      ? '#5da0e9'
      : color;
  const rotationInRadians = useMemo(() => toRadiansTuple(rotation), [rotation]);

  return (
    <group position={position} rotation={rotationInRadians} scale={scale}>
      <mesh
        geometry={geometry}
        dispose={usesSharedSTLGeometry ? null : undefined}
        onClick={onClick}
        onPointerEnter={() => onHover(true)}
        onPointerLeave={() => onHover(false)}
      >
        <meshStandardMaterial
          color={displayColor}
          transparent={isHovered && !isSelected}
          opacity={isHovered && !isSelected ? 0.85 : 1}
          side={THREE.DoubleSide}
        />
      </mesh>
      <lineSegments geometry={edgesGeometry}>
        <lineBasicMaterial
          color={isSelected ? '#ffffff' : isHovered ? '#aaccff' : '#000000'}
          transparent={!isSelected && !isHovered}
          opacity={isSelected || isHovered ? 1 : 0.15}
        />
      </lineSegments>
      <TopologyPicker edges={topologyEdges} vertices={topologyVertices} pickFilter={pickFilter} selectedIds={selectedIds} onSelect={onSelect} />
    </group>
  );
}

interface LineMeshProps {
  metadata: Record<string, unknown>;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  color: string;
  isSelected: boolean;
  isHovered: boolean;
  onClick: (e: ThreeEvent<MouseEvent>) => void;
  onHover: (hovered: boolean) => void;
  topologyEdges: GeometryEdge[];
  topologyVertices: GeometryVertex[];
  pickFilter: PickFilterType;
  selectedIds: string[];
  onSelect: (id: string, event: ThreeEvent<MouseEvent>) => void;
}

function LineMesh({ metadata, position, rotation, scale, color, isSelected, isHovered, onClick, onHover, topologyEdges, topologyVertices, pickFilter, selectedIds, onSelect }: LineMeshProps) {
  const geometry = useMemo(() => {
    try {
      const params = metadata as AnyShapeParams;
      if (!params.shapeType) return new THREE.BufferGeometry();
      const result = generateShape(params);
      return result.threeGeometry;
    } catch (e) {
      console.error('Failed to generate line geometry:', e);
      return new THREE.BufferGeometry();
    }
  }, [metadata]);

  // Create a tube-like mesh around lines for clickability
  const tubeMeshes = useMemo(() => {
    const posAttr = geometry.getAttribute('position');
    if (!posAttr) return [];
    const meshes: THREE.BufferGeometry[] = [];
    for (let i = 0; i < posAttr.count; i += 2) {
      const p1 = new THREE.Vector3(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
      const p2 = new THREE.Vector3(posAttr.getX(i + 1), posAttr.getY(i + 1), posAttr.getZ(i + 1));
      const dir = new THREE.Vector3().subVectors(p2, p1);
      const len = dir.length();
      const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);

      const tubeGeo = new THREE.CylinderGeometry(0.08, 0.08, len, 6);
      tubeGeo.rotateZ(Math.PI / 2);

      const quaternion = new THREE.Quaternion();
      quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir.normalize());

      const matrix = new THREE.Matrix4();
      matrix.compose(mid, quaternion, new THREE.Vector3(1, 1, 1));
      tubeGeo.applyMatrix4(matrix);
      meshes.push(tubeGeo);
    }
    return meshes;
  }, [geometry]);

  const mergedGeo = useMemo(() => {
    if (tubeMeshes.length === 0) return new THREE.BufferGeometry();
    const merged = new THREE.BufferGeometry();
    const allPositions: number[] = [];
    const allNormals: number[] = [];
    const allIndices: number[] = [];
    let indexOffset = 0;

    for (const geo of tubeMeshes) {
      const pos = geo.getAttribute('position');
      const norm = geo.getAttribute('normal');
      const idx = geo.getIndex();
      if (!pos || !idx) continue;

      for (let i = 0; i < pos.count; i++) {
        allPositions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
        if (norm) allNormals.push(norm.getX(i), norm.getY(i), norm.getZ(i));
      }
      for (let i = 0; i < idx.count; i++) {
        allIndices.push(idx.getX(i) + indexOffset);
      }
      indexOffset += pos.count;
    }

    merged.setAttribute('position', new THREE.Float32BufferAttribute(allPositions, 3));
    if (allNormals.length > 0) {
      merged.setAttribute('normal', new THREE.Float32BufferAttribute(allNormals, 3));
    }
    merged.setIndex(allIndices);
    return merged;
  }, [tubeMeshes]);

  const displayColor = isSelected ? '#4a90d9' : isHovered ? '#5da0e9' : color;
  const lineColor = isSelected ? '#ffffff' : isHovered ? '#aaccff' : color;
  const rotationInRadians = useMemo(() => toRadiansTuple(rotation), [rotation]);

  return (
    <group position={position} rotation={rotationInRadians} scale={scale}>
      {/* Visible lines */}
      <lineSegments geometry={geometry}>
        <lineBasicMaterial color={lineColor} linewidth={2} />
      </lineSegments>

      {/* Invisible clickable tubes */}
      <mesh
        geometry={mergedGeo}
        onClick={onClick}
        onPointerEnter={() => onHover(true)}
        onPointerLeave={() => onHover(false)}
      >
        <meshStandardMaterial
          color={displayColor}
          transparent
          opacity={isSelected || isHovered ? 0.6 : 0}
        />
      </mesh>

      {/* Nodes (spheres at vertices) */}
      <NodeSpheres geometry={geometry} color={displayColor} isSelected={isSelected} />
      <TopologyPicker edges={topologyEdges} vertices={topologyVertices} pickFilter={pickFilter} selectedIds={selectedIds} onSelect={onSelect} />
    </group>
  );
}

function TopologyPicker({
  edges,
  vertices,
  pickFilter,
  selectedIds,
  onSelect,
}: {
  edges: GeometryEdge[];
  vertices: GeometryVertex[];
  pickFilter: PickFilterType;
  selectedIds: string[];
  onSelect: (id: string, event: ThreeEvent<MouseEvent>) => void;
}) {
  const vertexMap = useMemo(() => new Map(vertices.map((vertex) => [vertex.id, vertex])), [vertices]);
  return (
    <>
      {edges.map((edge) => {
        const start = vertexMap.get(edge.vertex_ids[0]);
        const end = vertexMap.get(edge.vertex_ids[1]);
        const selected = selectedIds.includes(edge.id);
        if (!start || !end || (pickFilter !== 'edge' && !selected)) return null;
        return <EdgePicker key={edge.id} edge={edge} start={start.position} end={end.position} selected={selected} onSelect={onSelect} />;
      })}
      {vertices.map((vertex) => {
        const selected = selectedIds.includes(vertex.id);
        if (pickFilter !== 'vertex' && !selected) return null;
        return (
          <mesh key={vertex.id} position={vertex.position} onClick={(event) => onSelect(vertex.id, event)}>
            <sphereGeometry args={[0.14, 10, 10]} />
            <meshStandardMaterial color={selected ? '#ffffff' : '#ffca28'} depthTest={false} />
          </mesh>
        );
      })}
    </>
  );
}

function EdgePicker({
  edge,
  start,
  end,
  selected,
  onSelect,
}: {
  edge: GeometryEdge;
  start: [number, number, number];
  end: [number, number, number];
  selected: boolean;
  onSelect: (id: string, event: ThreeEvent<MouseEvent>) => void;
}) {
  const transform = useMemo(() => {
    const from = new THREE.Vector3(...start);
    const to = new THREE.Vector3(...end);
    const direction = new THREE.Vector3().subVectors(to, from);
    const length = direction.length();
    const midpoint = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    return { length, midpoint, quaternion };
  }, [end, start]);
  if (transform.length <= 1e-12) return null;
  return (
    <mesh position={transform.midpoint} quaternion={transform.quaternion} onClick={(event) => onSelect(edge.id, event)}>
      <cylinderGeometry args={[0.07, 0.07, transform.length, 6]} />
      <meshStandardMaterial color={selected ? '#ffffff' : '#ff9800'} transparent opacity={selected ? 1 : 0.7} depthTest={false} />
    </mesh>
  );
}

function NodeSpheres({ geometry, color, isSelected }: { geometry: THREE.BufferGeometry; color: string; isSelected: boolean }) {
  const positions = useMemo(() => {
    const posAttr = geometry.getAttribute('position');
    if (!posAttr) return [];
    const unique = new Map<string, [number, number, number]>();
    for (let i = 0; i < posAttr.count; i++) {
      const key = `${posAttr.getX(i).toFixed(4)},${posAttr.getY(i).toFixed(4)},${posAttr.getZ(i).toFixed(4)}`;
      if (!unique.has(key)) {
        unique.set(key, [posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)]);
      }
    }
    return Array.from(unique.values());
  }, [geometry]);

  return (
    <>
      {positions.map((pos, i) => (
        <mesh key={i} position={pos}>
          <sphereGeometry args={[0.12, 8, 8]} />
          <meshStandardMaterial color={isSelected ? '#ffffff' : color} />
        </mesh>
      ))}
    </>
  );
}
