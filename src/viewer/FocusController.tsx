import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import type { Vector3 } from 'three';
import { useViewerState } from './view-state';
import { focusCamera } from './focus-bounds';

export function FocusController() {
  const request = useViewerState((state) => state.focus);
  const { camera, controls, invalidate } = useThree();
  useEffect(() => {
    if (!request?.points.length) return;
    const center = focusCamera(camera, request.points, request.direction);
    if (!center) return;
    const orbit = controls as unknown as { target?: Vector3; update?: () => void } | null;
    orbit?.target?.copy(center); orbit?.update?.(); camera.lookAt(center); invalidate();
  }, [request, camera, controls, invalidate]);
  return null;
}
