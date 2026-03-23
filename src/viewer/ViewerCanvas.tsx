import { Canvas } from '@react-three/fiber';
import { OrbitControls, GizmoHelper, GizmoViewport, Grid } from '@react-three/drei';
import { useAppStore } from '@/state/store';
import { GeometryRenderer } from './GeometryRenderer';

export function ViewerCanvas() {
  const showGrid = useAppStore((s) => s.showGrid);
  const showAxes = useAppStore((s) => s.showAxes);

  return (
    <div className="w-full h-full">
      <Canvas
        camera={{ position: [10, 10, 10], fov: 50, near: 0.1, far: 10000 }}
        style={{ background: '#1a1a2e' }}
        frameloop="demand"
      >
        {/* Lighting */}
        <ambientLight intensity={0.4} />
        <directionalLight position={[10, 20, 10]} intensity={0.8} />
        <directionalLight position={[-10, -5, -10]} intensity={0.3} />

        {/* Controls */}
        <OrbitControls makeDefault enableDamping dampingFactor={0.1} />

        {/* Grid */}
        {showGrid && (
          <Grid
            infiniteGrid
            cellSize={1}
            sectionSize={5}
            cellColor="#2a2a4a"
            sectionColor="#3a3a5a"
            fadeDistance={50}
            fadeStrength={1}
          />
        )}

        {/* Axes */}
        {showAxes && <axesHelper args={[5]} />}

        {/* Geometry from IR */}
        <GeometryRenderer />

        {/* View orientation gizmo */}
        <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
          <GizmoViewport
            axisColors={['#f44336', '#4caf50', '#2196f3']}
            labelColor="#ffffff"
          />
        </GizmoHelper>
      </Canvas>
    </div>
  );
}
