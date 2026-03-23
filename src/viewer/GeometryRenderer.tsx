import { useAppStore } from '@/state/store';
import * as THREE from 'three';
import { useMemo } from 'react';
import type { ThreeEvent } from '@react-three/fiber';

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
        const isSelected = selectedIds.includes(body.id);
        const isHovered = hoveredId === body.id;

        return (
          <BodyMesh
            key={body.id}
            body={body}
            isSelected={isSelected}
            isHovered={isHovered}
            onSelect={(e: ThreeEvent<MouseEvent>) => {
              e.stopPropagation();
              if (e.nativeEvent.shiftKey || e.nativeEvent.ctrlKey || e.nativeEvent.metaKey) {
                toggleEntitySelection(body.id);
              } else {
                setSelectedEntities([body.id]);
              }
            }}
            onHover={(hovered: boolean) => setHoveredEntity(hovered ? body.id : null)}
          />
        );
      })}
    </group>
  );
}

interface BodyMeshProps {
  body: {
    id: string;
    color: string;
    transform: {
      position: [number, number, number];
      scale: [number, number, number];
    };
    metadata: Record<string, unknown>;
  };
  isSelected: boolean;
  isHovered: boolean;
  onSelect: (e: ThreeEvent<MouseEvent>) => void;
  onHover: (hovered: boolean) => void;
}

function BodyMesh({ body, isSelected, isHovered, onSelect, onHover }: BodyMeshProps) {
  const geometry = useMemo(() => {
    const meta = body.metadata;
    const shapeType = (meta.shapeType as string) ?? 'box';
    switch (shapeType) {
      case 'cylinder':
        return new THREE.CylinderGeometry(
          (meta.radius as number) ?? 1,
          (meta.radius as number) ?? 1,
          (meta.height as number) ?? 2,
          32,
        );
      case 'plate':
        return new THREE.BoxGeometry(
          (meta.width as number) ?? 4,
          (meta.thickness as number) ?? 0.2,
          (meta.depth as number) ?? 2,
        );
      case 'box':
      default:
        return new THREE.BoxGeometry(
          (meta.width as number) ?? 1,
          (meta.height as number) ?? 1,
          (meta.depth as number) ?? 1,
        );
    }
  }, [body.metadata]);

  const edgesGeometry = useMemo(() => new THREE.EdgesGeometry(geometry), [geometry]);

  const color = isSelected
    ? '#4a90d9'
    : isHovered
      ? '#5da0e9'
      : body.color || '#607d8b';

  return (
    <mesh
      geometry={geometry}
      position={body.transform.position}
      scale={body.transform.scale}
      onClick={onSelect}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
    >
      <meshStandardMaterial
        color={color}
        transparent={isHovered && !isSelected}
        opacity={isHovered && !isSelected ? 0.85 : 1}
      />
      {(isSelected || isHovered) && (
        <lineSegments geometry={edgesGeometry}>
          <lineBasicMaterial color={isSelected ? '#ffffff' : '#aaccff'} />
        </lineSegments>
      )}
    </mesh>
  );
}
