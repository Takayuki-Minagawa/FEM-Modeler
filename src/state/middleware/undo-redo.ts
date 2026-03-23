import type { ProjectIR } from '@/core/ir/types';

export interface UndoRedoManager {
  /**
   * Save state BEFORE a mutation. Call this once before modifying state.
   * The "current" pointer is moved forward when saveBefore + saveAfter are paired.
   */
  saveBefore: (ir: ProjectIR) => void;
  /**
   * Save state AFTER a mutation. Must be called after saveBefore + mutation.
   * This creates a complete undo entry (before → after).
   */
  saveAfter: (ir: ProjectIR) => void;
  undo: () => ProjectIR | null;
  redo: () => ProjectIR | null;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clear: () => void;
}

interface HistoryEntry {
  before: string;
  after: string;
}

const MAX_HISTORY = 100;

export function createUndoRedoManager(): UndoRedoManager {
  const history: HistoryEntry[] = [];
  let pendingBefore: string | null = null;
  const redoStack: HistoryEntry[] = [];

  return {
    saveBefore(ir: ProjectIR) {
      pendingBefore = JSON.stringify(ir);
    },

    saveAfter(ir: ProjectIR) {
      if (pendingBefore === null) return;
      const after = JSON.stringify(ir);
      // Only push if state actually changed
      if (pendingBefore !== after) {
        history.push({ before: pendingBefore, after });
        if (history.length > MAX_HISTORY) history.shift();
        redoStack.length = 0;
      }
      pendingBefore = null;
    },

    undo(): ProjectIR | null {
      if (history.length === 0) return null;
      const entry = history.pop()!;
      redoStack.push(entry);
      return JSON.parse(entry.before);
    },

    redo(): ProjectIR | null {
      if (redoStack.length === 0) return null;
      const entry = redoStack.pop()!;
      history.push(entry);
      return JSON.parse(entry.after);
    },

    canUndo: () => history.length > 0,
    canRedo: () => redoStack.length > 0,

    clear() {
      history.length = 0;
      redoStack.length = 0;
      pendingBefore = null;
    },
  };
}
