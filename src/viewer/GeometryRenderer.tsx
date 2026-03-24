import { useAppStore } from '@/state/store';
import * as THREE from 'three';
import { useMemo } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { generateShape } from '@/geometry/primitives/generators';
import type { AnyShapeParams } from '@/geometry/primitives/types';
import { getSTLGeometry } from '@/geometry/import/stl-geometry-cache';
import { toRadiansTuple } from '@/geometry/transforms';

export function GeometryRenderer() {
  const bodies = useAppStore((s) => s.ir.geometry.bodies);
  const selectedIds = useAppStore((s) => s.selectedEntityIds);
  const hoveredId = useAppStore((s) => s.hoveredEntityId);
  const setSelectedEntities = useAppStore((s) => s.setSelectedEntities);
  const toggleEntitySelection = useAppStore((s) => s.toggleEntitySelection);
  const setHoveredEntity = useAppStore((s) => s.setHoveredEntity);

  return (
    <group>
      {bodies.map((body) => {
        if (!body.visible) return null;
        const isSelected = selectedIds.includes(body.id);
        const isHovered = hoveredId === body.id;
        const isLineModel = body.category === 'beam_region';

        const handleClick = (e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          if (e.nativeEvent.shiftKey || e.nativeEvent.ctrlKey || e.nativeEvent.metaKey) {
            toggleEntitySelection(body.id);
          } else {
            setSelectedEntities([body.id]);
          }
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
              onClick={handleClick}
              onHover={(h) => setHoveredEntity(h ? body.id : null)}
            />
          );
        }

        return (
          <SolidMesh
            key={body.id}
            bodyId={body.id}
            metadata={body.metadata}
            position={body.transform.position}
            rotation={body.transform.rotation}
            scale={body.transform.scale}
            color={body.color}
            isSelected={isSelected}
            isHovered={isHovered}
            onClick={handleClick}
            onHover={(h) => setHoveredEntity(h ? body.id : null)}
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
  metadata: Record<string, unknown>;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  color: string;
  isSelected: boolean;
  isHovered: boolean;
  onClick: (e: ThreeEvent<MouseEvent>) => void;
  onHover: (hovered: boolean) => void;
}

function SolidMesh({ bodyId, metadata, position, rotation, scale, color, isSelected, isHovered, onClick, onHover }: SolidMeshProps) {
  const geometry = useMemo(() => {
    try {
      const params = metadata as AnyShapeParams;
      if (!params.shapeType) return new THREE.BoxGeometry(1, 1, 1);
      // Use cached geometry for imported STL bodies
      if (params.shapeType === 'imported_stl') {
        const cached = getSTLGeometry(bodyId);
        if (cached) return cached;
        return new THREE.BoxGeometry(1, 1, 1);
      }
      const result = generateShape(params);
      return result.threeGeometry;
    } catch (e) {
      console.error('Failed to generate solid geometry:', e);
      return new THREE.BoxGeometry(1, 1, 1);
    }
  }, [bodyId, metadata]);

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
}

function LineMesh({ metadata, position, rotation, scale, color, isSelected, isHovered, onClick, onHover }: LineMeshProps) {
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
    </group>
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
