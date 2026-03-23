import type { ProjectIR } from '@/core/ir/types';

export interface UndoRedoManager {
  pushState: (ir: ProjectIR) => void;
  undo: () => ProjectIR | null;
  redo: () => ProjectIR | null;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clear: () => void;
}

const MAX_HISTORY = 100;

export function createUndoRedoManager(): UndoRedoManager {
  const undoStack: string[] = [];
  const redoStack: string[] = [];

  return {
    pushState(ir: ProjectIR) {
      undoStack.push(JSON.stringify(ir));
      if (undoStack.length > MAX_HISTORY) undoStack.shift();
      redoStack.length = 0;
    },

    undo(): ProjectIR | null {
      if (undoStack.length === 0) return null;
      const current = undoStack.pop()!;
      redoStack.push(current);
      return undoStack.length > 0
        ? JSON.parse(undoStack[undoStack.length - 1])
        : null;
    },

    redo(): ProjectIR | null {
      if (redoStack.length === 0) return null;
      const state = redoStack.pop()!;
      undoStack.push(state);
      return JSON.parse(state);
    },

    canUndo: () => undoStack.length > 1,
    canRedo: () => redoStack.length > 0,
    clear() {
      undoStack.length = 0;
      redoStack.length = 0;
    },
  };
}
