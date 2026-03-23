import {
  Panel,
  Group,
  Separator,
} from 'react-resizable-panels';
import { GlobalBar } from './GlobalBar';
import { LeftSidebar } from './LeftSidebar';
import { RightSidebar } from './RightSidebar';
import { BottomPanel } from './BottomPanel';
import { ViewerCanvas } from '@/viewer/ViewerCanvas';

export function AppLayout() {
  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden">
      <GlobalBar />

      <Group orientation="horizontal" className="flex-1">
        {/* Left sidebar */}
        <Panel defaultSize={20} minSize={14} maxSize={30}>
          <LeftSidebar />
        </Panel>
        <Separator />

        {/* Center: 3D + Bottom */}
        <Panel defaultSize={55} minSize={30}>
          <Group orientation="vertical">
            {/* 3D Viewer */}
            <Panel defaultSize={70} minSize={30}>
              <ViewerCanvas />
            </Panel>
            <Separator />

            {/* Bottom panel */}
            <Panel defaultSize={30} minSize={15} maxSize={50}>
              <BottomPanel />
            </Panel>
          </Group>
        </Panel>
        <Separator />

        {/* Right sidebar */}
        <Panel defaultSize={25} minSize={15} maxSize={35}>
          <RightSidebar />
        </Panel>
      </Group>
    </div>
  );
}
