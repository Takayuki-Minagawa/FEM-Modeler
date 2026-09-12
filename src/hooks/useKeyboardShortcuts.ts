import { useHotkeys } from 'react-hotkeys-hook';
import { useAppStore } from '@/state/store';
import { useAppActionsContext } from '@/hooks/useAppActionsContext';

// Dialogs own the keyboard while open, including when focus is on a button.
// Do not prevent default here: text editing shortcuts inside a modal stay native.
function modalIsOpen() {
  return document.querySelector('[role="dialog"][aria-modal="true"]') !== null;
}

export function useKeyboardShortcuts() {
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  const { saveProjectFile } = useAppActionsContext();

  // Undo
  useHotkeys('ctrl+z, meta+z', (e) => {
    if (modalIsOpen()) return;
    e.preventDefault();
    undo();
  }, { enableOnFormTags: false });

  // Redo
  useHotkeys('ctrl+shift+z, meta+shift+z', (e) => {
    if (modalIsOpen()) return;
    e.preventDefault();
    redo();
  }, { enableOnFormTags: false });

  // Save
  useHotkeys('ctrl+s, meta+s', (e) => {
    if (modalIsOpen()) return;
    e.preventDefault();
    saveProjectFile();
  }, { enableOnFormTags: true });

  // Delete selected
  useHotkeys('delete, backspace', () => {
    if (modalIsOpen()) return;
    const state = useAppStore.getState();
    const selected = state.selectedEntityIds;
    if (selected.length > 0) {
      state.removeBodies(selected);
    }
  }, { enableOnFormTags: false });

  // Escape: deselect
  useHotkeys('escape', () => {
    if (modalIsOpen()) return;
    useAppStore.getState().setSelectedEntities([]);
  });
}
