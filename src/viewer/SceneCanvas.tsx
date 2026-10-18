import { Component, StrictMode, Suspense, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createRoot, events, extend } from '@react-three/fiber';
import { AmbientLight, AxesHelper, BoxGeometry, CylinderGeometry, DirectionalLight, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, MeshStandardMaterial, OctahedronGeometry, OrthographicCamera, PlaneGeometry, Points, PointsMaterial, SphereGeometry, Sprite, SpriteMaterial } from 'three';

// Canvas registers the entire THREE namespace. Register only the primitives used
// by our viewer and Drei's Grid/Gizmo so unused Three features can be tree-shaken.
extend({ AmbientLight, AxesHelper, BoxGeometry, CylinderGeometry, DirectionalLight, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, MeshStandardMaterial, OctahedronGeometry, OrthographicCamera, PlaneGeometry, Points, PointsMaterial, SphereGeometry, Sprite, SpriteMaterial });

const camera = { position: [10, 10, 10] as [number, number, number], fov: 50, near: 0.1, far: 10000 };

class SceneErrorBoundary extends Component<{ children: ReactNode; onError: (error: Error) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { this.props.onError(error); }
  render() { return this.state.failed ? null : this.props.children; }
}

/** Application-specific R3F root. DOM UI/context stays above this canvas; scene state uses Zustand. */
export function SceneCanvas({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<ReturnType<typeof createRoot<HTMLCanvasElement>> | null>(null);
  const childrenRef = useRef<ReactNode>(null);
  const lifecycleRef = useRef({ generation: 0 });
  const [error, setError] = useState<Error | null>(null);

  useLayoutEffect(() => {
    childrenRef.current = <StrictMode><SceneErrorBoundary onError={setError}><Suspense fallback={null}>{children}</Suspense></SceneErrorBoundary></StrictMode>;
    rootRef.current?.render(childrenRef.current);
  }, [children]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current!;
    const container = containerRef.current!;
    const lifecycle = lifecycleRef.current;
    const generation = ++lifecycle.generation;
    let active = true;
    let scheduled = 0;
    const update = () => {
      scheduled = 0;
      if (!active) return;
      const { width, height, top, left } = container.getBoundingClientRect();
      if (!(width > 0 && height > 0)) return;
      const root = rootRef.current ??= createRoot(canvas);
      void root.configure({ camera, events, frameloop: 'demand', dpr: [1, 2], size: { width, height, top, left } })
        .then(() => { if (active) root.render(childrenRef.current); })
        .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason : new Error(String(reason))); });
    };
    const schedule = () => { if (!scheduled) scheduled = requestAnimationFrame(update); };
    const observer = new ResizeObserver(schedule);
    observer.observe(container);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    update();
    return () => {
      active = false;
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      cancelAnimationFrame(scheduled);
      // StrictMode replays effects on the same DOM canvas. Delay destruction one
      // microtask so that replay can reuse the root; real unmount still disposes it.
      queueMicrotask(() => {
        if (lifecycle.generation !== generation) return;
        rootRef.current?.unmount();
        rootRef.current = null;
      });
    };
  }, []);

  if (error) throw error;
  return <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', ...style }}>
    <canvas ref={canvasRef} style={{ display: 'block' }} />
  </div>;
}
