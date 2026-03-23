import { useHotkeys } from 'react-hotkeys-hook';
import { useAppStore } from '@/state/store';
import { downloadProjectFile } from '@/export/project/save';

export function useKeyboardShortcuts() {
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);

  // Undo
  useHotkeys('ctrl+z, meta+z', (e) => {
    e.preventDefault();
    undo();
  }, { enableOnFormTags: false });

  // Redo
  useHotkeys('ctrl+shift+z, meta+shift+z', (e) => {
    e.preventDefault();
    redo();
  }, { enableOnFormTags: false });

  // Save
  useHotkeys('ctrl+s, meta+s', (e) => {
    e.preventDefault();
    const ir = useAppStore.getState().ir;
    downloadProjectFile(ir);
  }, { enableOnFormTags: true });

  // Delete selected
  useHotkeys('delete, backspace', () => {
    const state = useAppStore.getState();
    const selected = state.selectedEntityIds;
    if (selected.length > 0) {
      selected.forEach((id) => {
        if (state.ir.geometry.bodies.some((b) => b.id === id)) {
          state.removeBody(id);
        }
      });
      state.setSelectedEntities([]);
    }
  }, { enableOnFormTags: false });

  // Escape: deselect
  useHotkeys('escape', () => {
    useAppStore.getState().setSelectedEntities([]);
  });
}
