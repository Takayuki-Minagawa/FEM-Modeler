import { useEffect, useMemo } from 'react';
import { BufferGeometry, DoubleSide, Float32BufferAttribute } from 'three';
import { useAppStore } from '@/state/store';
import { materialOverlays, type MaterialOverlay } from './material-data';
import { useViewerState } from './view-state';

export function MaterialOverlays() {
  const ir = useAppStore((state) => state.ir);
  const visible = useViewerState((state) => state.showMaterials);
  const overlays = useMemo(() => visible ? materialOverlays(ir) : [], [ir, visible]);
  return <group>{overlays.map((overlay) => <AssignedMaterial key={overlay.id} overlay={overlay} />)}</group>;
}

function AssignedMaterial({ overlay }: { overlay: MaterialOverlay }) {
  const surfaces = useMemo(() => new BufferGeometry().setAttribute('position', new Float32BufferAttribute(overlay.target.triangles, 3)), [overlay.target]);
  const lines = useMemo(() => new BufferGeometry().setAttribute('position', new Float32BufferAttribute(overlay.segments, 3)), [overlay.segments]);
  useEffect(() => () => { surfaces.dispose(); lines.dispose(); }, [surfaces, lines]);
  return <group>
    {overlay.target.triangles.length > 0 && <mesh geometry={surfaces} renderOrder={2}>
      <meshBasicMaterial color={overlay.color} transparent opacity={0.32} depthWrite={false} side={DoubleSide} polygonOffset polygonOffsetFactor={-2} />
    </mesh>}
    {overlay.segments.length > 0 && <lineSegments geometry={lines} renderOrder={2}>
      <lineBasicMaterial color={overlay.color} depthTest={false} />
    </lineSegments>}
  </group>;
}
