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
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/ui/dialogs/Modal';
import { useViewportWidth } from './useViewportWidth';

export function AppLayout() {
  const { t } = useTranslation();
  const wide = useViewportWidth() >= 1200;
  const [treeExpanded, setTreeExpanded] = useState(() => window.innerWidth >= 1200);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  useEffect(() => {
    const open = () => setPropertiesOpen(true);
    window.addEventListener('fem-open-properties', open);
    return () => window.removeEventListener('fem-open-properties', open);
  }, []);
  const left = <LeftSidebar collapsed={!treeExpanded} onNavigate={() => { if (!wide) setPropertiesOpen(true); }} />;
  const center = <Group orientation="vertical" data-panel-group-direction="vertical" resizeTargetMinimumSize={{ fine: 12, coarse: 28 }}>
    <Panel defaultSize="70%" minSize="30%"><ViewerCanvas /></Panel>
    <Separator />
    <Panel defaultSize="30%" minSize="15%" maxSize="50%"><BottomPanel /></Panel>
  </Group>;
  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden">
      <GlobalBar treeExpanded={treeExpanded} onToggleTree={() => setTreeExpanded((open) => !open)}
        propertiesOpen={wide || propertiesOpen} onToggleProperties={!wide ? () => setPropertiesOpen((open) => !open) : undefined} />

      {wide ?
      <Group
        orientation="horizontal"
        className="flex-1 min-h-0"
        data-panel-group-direction="horizontal"
        resizeTargetMinimumSize={{ fine: 12, coarse: 28 }}
      >
        {/* Left sidebar */}
        <Panel key={treeExpanded ? 'tree-open' : 'tree-closed'} defaultSize={treeExpanded ? '220px' : '56px'} minSize={treeExpanded ? '180px' : '56px'} maxSize={treeExpanded ? '320px' : '56px'}>
          {left}
        </Panel>
        <Separator />

        {/* Center: 3D + Bottom */}
        <Panel minSize="240px">
          {center}
        </Panel>
        <Separator />

        {/* Right sidebar */}
        <Panel
          defaultSize="340px"
          minSize="280px"
          maxSize="560px"
          groupResizeBehavior="preserve-pixel-size"
        >
          <RightSidebar />
        </Panel>
      </Group>
      : <div className="flex flex-1 min-h-0 min-w-0">
        <aside className="shrink-0 border-r" style={{ width: treeExpanded ? 220 : 56, borderColor: 'var(--color-border)' }}>{left}</aside>
        <main className="flex-1 min-w-0">{center}</main>
      </div>}
      <Modal isOpen={!wide && propertiesOpen} onClose={() => setPropertiesOpen(false)} labelledBy="properties-drawer-title" className="property-drawer">
        <div className="flex flex-col h-full min-h-0">
          <div className="flex justify-between items-center p-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
            <h2 id="properties-drawer-title">{t('workflow.properties')}</h2>
            <button type="button" aria-label={t('workflow.closeProperties')} onClick={() => setPropertiesOpen(false)} className="p-2">×</button>
          </div>
          <div className="flex-1 min-h-0"><RightSidebar /></div>
        </div>
      </Modal>
    </div>
  );
}
