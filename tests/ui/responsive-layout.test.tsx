// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import i18n from '@/i18n';
import { useAppStore } from '@/state/store';
import { AppLayout } from '@/ui/layout/AppLayout';

vi.mock('react-resizable-panels', () => ({
  Panel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Group: ({ children }: { children: ReactNode }) => <div>{children}</div>, Separator: () => <hr />,
}));
vi.mock('@/viewer/ViewerCanvas', () => ({ ViewerCanvas: () => <div>Viewer</div> }));
vi.mock('@/ui/layout/BottomPanel', () => ({ BottomPanel: () => <div>Bottom</div> }));
vi.mock('@/ui/layout/RightSidebar', () => ({ RightSidebar: () => <section aria-label="Properties"><input aria-label="Property input" /></section> }));
vi.mock('@/hooks/useAppContext', () => ({ useAppContext: () => ({ theme: 'dark', toggleTheme: vi.fn(), openHelp: vi.fn(), openImport: vi.fn(), saveProjectFile: vi.fn(), draftSummary: null, autosaveState: { status: 'idle' }, restoreDraft: vi.fn() }) }));
vi.mock('@/hooks/useProjectFileLoader', () => ({ useProjectFileLoader: () => ({ openFilePicker: vi.fn() }) }));
beforeEach(async () => { await i18n.changeLanguage('en'); useAppStore.getState().createProject('Layout project', 'solid'); });
afterEach(cleanup);
function resize(width: number) { act(() => { window.innerWidth = width; window.dispatchEvent(new Event('resize')); }); }

describe('responsive shell', () => {
  it.each([600, 1024, 1280, 1440])('keeps navigation and overflow actions available at %d px', (width) => {
    resize(width); render(<AppLayout />);
    expect(screen.getByRole('navigation', { name: 'Model tree' })).toBeTruthy();
    fireEvent.click(screen.getByText('More actions'));
    expect(screen.getByRole('button', { name: 'Save', exact: true })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Display unit system' })).toBeTruthy();
    const toggle = screen.getByRole('button', { name: 'Toggle model tree' });
    const before = toggle.getAttribute('aria-expanded'); fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).not.toBe(before);
  });

  it('opens a keyboard-trapped properties drawer from tree navigation and diagnostic events', () => {
    resize(600); render(<AppLayout />);
    const navigation = screen.getByRole('button', { name: 'Geometry', exact: true });
    navigation.focus(); fireEvent.click(navigation);
    expect(screen.getByRole('dialog', { name: 'Properties' })).toBeTruthy();
    const close = screen.getByRole('button', { name: 'Close properties' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(navigation);
    act(() => window.dispatchEvent(new Event('fem-open-properties')));
    expect(screen.getByRole('dialog', { name: 'Properties' })).toBeTruthy();
  });

  it('renames the project through its labelled control and supports Undo', () => {
    resize(1440); render(<AppLayout />);
    fireEvent.click(screen.getByRole('button', { name: 'Rename project: Layout project' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Project name' }), { target: { value: 'New project name' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Project name' }), { key: 'Enter' });
    expect(useAppStore.getState().ir.meta.project_name).toBe('New project name');
    act(() => useAppStore.getState().undo());
    expect(useAppStore.getState().ir.meta.project_name).toBe('Layout project');
  });
});
