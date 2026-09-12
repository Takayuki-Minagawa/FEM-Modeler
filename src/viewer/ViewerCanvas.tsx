import { Canvas } from '@react-three/fiber';
import { OrbitControls, GizmoHelper, GizmoViewport, Grid } from '@react-three/drei';
import { useAppStore } from '@/state/store';
import { useAppUiContext } from '@/hooks/useAppUiContext';
import { GeometryRenderer } from './GeometryRenderer';
import { AnalysisOverlays, FocusController } from './AnalysisOverlays';
import { ResultOverlay } from './ResultOverlay';
import { ViewerControls } from './ViewerControls';
import { useViewerState } from './view-state';

export function ViewerCanvas() {
  const resultId = useViewerState((s) => s.resultId);
  const hasResult = useAppStore((s) => s.ir.results.some((r) => r.id === resultId && r.mesh));
  const showGrid = useAppStore((s) => s.showGrid);
  const showAxes = useAppStore((s) => s.showAxes);
  const { theme } = useAppUiContext();
  const isDark = theme !== 'light';

  const bgColor = isDark ? '#1a1a2e' : '#e8ecf0';
  const gridCellColor = isDark ? '#2a2a4a' : '#c0c8d0';
  const gridSectionColor = isDark ? '#3a3a5a' : '#a0a8b0';

  return (
    <div className="w-full h-full relative">
      <ViewerControls />
      <Canvas
        camera={{ position: [10, 10, 10], fov: 50, near: 0.1, far: 10000 }}
        style={{ background: bgColor }}
        frameloop="demand"
      >
        <ambientLight intensity={isDark ? 0.4 : 0.6} />
        <directionalLight position={[10, 20, 10]} intensity={isDark ? 0.8 : 1.0} />
        <directionalLight position={[-10, -5, -10]} intensity={isDark ? 0.3 : 0.4} />

        <OrbitControls makeDefault enableDamping dampingFactor={0.1} />

        {showGrid && (
          <Grid
            infiniteGrid
            cellSize={1}
            sectionSize={5}
            cellColor={gridCellColor}
            sectionColor={gridSectionColor}
            fadeDistance={50}
            fadeStrength={1}
          />
        )}

        {showAxes && <axesHelper args={[5]} />}

        {hasResult ? <ResultOverlay /> : <><GeometryRenderer /><AnalysisOverlays /></>}
        <FocusController />

        <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
          <GizmoViewport
            axisColors={['#f44336', '#4caf50', '#2196f3']}
            labelColor={isDark ? '#ffffff' : '#333333'}
          />
        </GizmoHelper>
      </Canvas>
    </div>
  );
}
