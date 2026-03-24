import { useHotkeys } from 'react-hotkeys-hook';
import { useAppStore } from '@/state/store';
import { useAppContext } from '@/hooks/useAppContext';

export function useKeyboardShortcuts() {
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  const { saveProjectFile } = useAppContext();

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
    saveProjectFile();
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
