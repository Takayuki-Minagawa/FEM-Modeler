import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useAppStore } from '@/state/store';
import { conditionOverlays } from './condition-data';
import type { ConditionOverlay } from './condition-data';
import { useViewerState } from './view-state';

export function AnalysisOverlays() {
  const ir = useAppStore((state) => state.ir);
  const conditions = useViewerState((state) => state.showConditions);
  const materials = useViewerState((state) => state.showMaterials);
  const overlays = useMemo(() => conditions || materials ? conditionOverlays(ir).filter((item) => item.kind === 'material' ? materials : conditions) : [], [ir, conditions, materials]);
  return <group>{overlays.map((overlay) => <Overlay key={overlay.id} overlay={overlay} />)}</group>;
}
function Overlay({ overlay }: { overlay: ConditionOverlay }) {
  const geometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(overlay.target.triangles, 3));
    geometry.computeVertexNormals();
    return geometry;
  }, [overlay.target]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const points = overlay.target.points;
  const bounds = new THREE.Box3().setFromPoints(points.map((p) => new THREE.Vector3(...p)));
  const center = bounds.getCenter(new THREE.Vector3());
  const size = Math.max(bounds.getSize(new THREE.Vector3()).length() * 0.12, 0.05);
  const arrow = useMemo(() => {
    if (!overlay.direction || Math.hypot(...overlay.direction) < 1e-12) return null;
    return new THREE.ArrowHelper(new THREE.Vector3(...overlay.direction).normalize(), center, size * 3, overlay.color, size, size * 0.5);
  }, [overlay.direction, overlay.color, center.x, center.y, center.z, size]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => arrow?.dispose(), [arrow]);
  if (!points.length) return null;
  return <group>
    {overlay.target.triangles.length > 0 && <mesh geometry={geometry} renderOrder={2}><meshBasicMaterial color={overlay.color} transparent opacity={0.32} depthWrite={false} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={-2} /></mesh>}
    {overlay.kind === 'bc' && overlay.constraints && <ConstraintAxes directions={overlay.constraints} position={center} size={size} color={overlay.color} />}
    {overlay.kind === 'bc' && <mesh position={center} renderOrder={3}><octahedronGeometry args={[size, 0]} /><meshBasicMaterial color={overlay.color} wireframe depthTest={false} /></mesh>}
    {overlay.kind === 'load' && overlay.arrows?.length ? <PressureArrows arrows={overlay.arrows} size={size} color={overlay.color} /> : overlay.kind === 'load' && (arrow ? <primitive object={arrow} /> : <mesh position={center}><sphereGeometry args={[size * 0.5, 8, 6]} /><meshBasicMaterial color={overlay.color} depthTest={false} /></mesh>)}
  </group>;
}

export function FocusController() {
  const request = useViewerState((state) => state.focus);
  const { camera, controls, invalidate } = useThree();
  useEffect(() => {
    if (!request?.points.length) return;
    const bounds = new THREE.Box3().setFromPoints(request.points.map((point) => new THREE.Vector3(...point)));
    const center = bounds.getCenter(new THREE.Vector3());
    const radius = Math.max(bounds.getSize(new THREE.Vector3()).length() / 2, 0.05);
    const distance = camera instanceof THREE.PerspectiveCamera ? radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.3 : radius * 3;
    const direction = camera.position.clone().sub(center).normalize();
    if (direction.lengthSq() === 0) direction.set(1, 1, 1).normalize();
    camera.position.copy(center).addScaledVector(direction, distance);
    updateCameraClipping(camera, distance);
    const orbit = controls as unknown as { target?: THREE.Vector3; update?: () => void } | null;
    orbit?.target?.copy(center); orbit?.update?.(); camera.lookAt(center); invalidate();
  }, [request, camera, controls, invalidate]);
  return null;
}

function updateCameraClipping(camera: THREE.Camera, distance: number) {
  if (camera instanceof THREE.PerspectiveCamera || camera instanceof THREE.OrthographicCamera) {
    camera.near = Math.max(distance / 1000, 0.00001); camera.far = Math.max(distance * 100, 1000); camera.updateProjectionMatrix();
  }
}

function ConstraintAxes({ directions, position, size, color }: { directions: [number, number, number][]; position: THREE.Vector3; size: number; color: string }) {
  const geometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(directions.flatMap((direction) => [...direction.map((v) => -v * size * 2), ...direction.map((v) => v * size * 2)]), 3));
    return geometry;
  }, [directions, size]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <lineSegments geometry={geometry} position={position}><lineBasicMaterial color={color} depthTest={false} /></lineSegments>;
}

function PressureArrows({ arrows, size, color }: { arrows: { position: [number, number, number]; direction: [number, number, number] }[]; size: number; color: string }) {
  const helpers = useMemo(() => arrows.filter((arrow) => Math.hypot(...arrow.direction) > 0).map((arrow) => new THREE.ArrowHelper(new THREE.Vector3(...arrow.direction).normalize(), new THREE.Vector3(...arrow.position), size * 3, color, size, size * 0.5)), [arrows, size, color]);
  useEffect(() => () => helpers.forEach((helper) => helper.dispose()), [helpers]);
  return <group>{helpers.map((helper, index) => <primitive key={index} object={helper} />)}</group>;
}
