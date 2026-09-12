import { applyPatches, enablePatches, type Patch } from 'immer';
import type { ProjectIR } from '@/core/ir/types';

enablePatches();

export interface HistoryStats { undoEntries: number; redoEntries: number; estimatedBytes: number }
export interface UndoRedoManager {
  record: (patches: Patch[], inversePatches: Patch[]) => void;
  undo: (ir: ProjectIR) => ProjectIR | null;
  redo: (ir: ProjectIR) => ProjectIR | null;
  canUndo: () => boolean;
  canRedo: () => boolean;
  stats: () => HistoryStats;
  clear: () => void;
}
interface HistoryEntry { patches: Patch[]; inversePatches: Patch[]; bytes: number }

/** Conservative retained-value estimate; immutable shared objects are visited once. */
function estimateBytes(value: unknown, seen: WeakSet<object>): number {
  if (typeof value === 'string') return value.length * 2 + 16;
  if (value === null || typeof value !== 'object') return 16;
  if (seen.has(value)) return 0;
  seen.add(value);
  if (Array.isArray(value)) return 32 + value.reduce((sum, item) => sum + estimateBytes(item, seen), 0);
  return 48 + Object.entries(value).reduce((sum, [key, item]) => sum + key.length * 2 + estimateBytes(item, seen), 0);
}

export function createUndoRedoManager(options: { maxEntries?: number; maxBytes?: number } = {}): UndoRedoManager {
  const maxEntries = options.maxEntries ?? 100;
  const maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
  const history: HistoryEntry[] = [];
  const redoStack: HistoryEntry[] = [];
  let bytes = 0;
  return {
    record(patches, inversePatches) {
      if (!patches.length) return;
      for (const entry of redoStack) bytes -= entry.bytes;
      redoStack.length = 0;
      const seen = new WeakSet<object>();
      const entry = { patches, inversePatches, bytes: estimateBytes(patches, seen) + estimateBytes(inversePatches, seen) };
      history.push(entry);
      bytes += entry.bytes;
      // An individual oversized operation is deliberately not retained: the cap is real.
      while (history.length > maxEntries || bytes > maxBytes) bytes -= history.shift()!.bytes;
    },
    undo(ir) {
      const entry = history.pop();
      if (!entry) return null;
      redoStack.push(entry);
      return applyPatches(ir, entry.inversePatches);
    },
    redo(ir) {
      const entry = redoStack.pop();
      if (!entry) return null;
      history.push(entry);
      return applyPatches(ir, entry.patches);
    },
    canUndo: () => history.length > 0,
    canRedo: () => redoStack.length > 0,
    stats: () => ({ undoEntries: history.length, redoEntries: redoStack.length, estimatedBytes: bytes }),
    clear() { history.length = 0; redoStack.length = 0; bytes = 0; },
  };
}
