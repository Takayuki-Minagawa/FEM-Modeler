import { applyPatches, current as currentDraft, enablePatches, isDraft, produceWithPatches, type Draft, type Patch } from 'immer';
import type { ProjectIR } from '@/core/ir/types';

enablePatches();

export interface UndoRedoManager {
  saveBefore: (ir: ProjectIR) => void;
  saveAfter: (ir: ProjectIR) => void;
  undo: () => ProjectIR | null;
  redo: () => ProjectIR | null;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clear: () => void;
}

interface HistoryEntry {
  patches: Patch[];
  inversePatches: Patch[];
}

const MAX_HISTORY = 100;

function cloneIR(ir: ProjectIR): ProjectIR {
  const plain = isDraft(ir) ? currentDraft(ir as Draft<ProjectIR>) : ir;
  return structuredClone(plain) as ProjectIR;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Synchronize a draft recursively so Immer emits narrow patches instead of a full IR snapshot. */
function syncValue(draft: unknown, target: unknown): unknown {
  if (Object.is(draft, target)) return draft;
  if (!isObject(draft) || !isObject(target) || Array.isArray(draft) !== Array.isArray(target)) {
    return structuredClone(target);
  }

  if (Array.isArray(draft) && Array.isArray(target)) {
    // Binary/mesh asset arrays are intentionally replaced as one patch; recursively
    // patching millions of coordinates costs more memory than a single asset revision.
    if (target.length > 2_000) return structuredClone(target);
    const targetLength = target.length;
    while (draft.length > targetLength) draft.pop();
    for (let index = 0; index < targetLength; index += 1) {
      if (index >= draft.length) {
        draft.push(structuredClone(target[index]));
      } else {
        const replacement = syncValue(draft[index], target[index]);
        if (replacement !== draft[index]) draft[index] = replacement;
      }
    }
    return draft;
  }

  const draftRecord = draft as Record<string, unknown>;
  const targetRecord = target as Record<string, unknown>;
  for (const key of Object.keys(draftRecord)) {
    if (!(key in targetRecord)) delete draftRecord[key];
  }
  for (const [key, targetValue] of Object.entries(targetRecord)) {
    if (!(key in draftRecord)) {
      draftRecord[key] = structuredClone(targetValue);
      continue;
    }
    const replacement = syncValue(draftRecord[key], targetValue);
    if (replacement !== draftRecord[key]) draftRecord[key] = replacement;
  }
  return draftRecord;
}

export function createUndoRedoManager(): UndoRedoManager {
  const history: HistoryEntry[] = [];
  const redoStack: HistoryEntry[] = [];
  let pendingBefore: ProjectIR | null = null;
  let current: ProjectIR | null = null;

  return {
    saveBefore(ir) {
      pendingBefore = cloneIR(ir);
      current = pendingBefore;
    },

    saveAfter(ir) {
      if (!pendingBefore) return;
      const target = cloneIR(ir);
      const [next, patches, inversePatches] = produceWithPatches(
        pendingBefore,
        (draft: Draft<ProjectIR>) => {
          syncValue(draft, target);
        },
      );
      if (patches.length > 0) {
        history.push({ patches, inversePatches });
        if (history.length > MAX_HISTORY) history.shift();
        redoStack.length = 0;
      }
      current = next;
      pendingBefore = null;
    },

    undo() {
      const entry = history.pop();
      if (!entry || !current) return null;
      current = applyPatches(current, entry.inversePatches);
      redoStack.push(entry);
      return cloneIR(current);
    },

    redo() {
      const entry = redoStack.pop();
      if (!entry || !current) return null;
      current = applyPatches(current, entry.patches);
      history.push(entry);
      return cloneIR(current);
    },

    canUndo: () => history.length > 0,
    canRedo: () => redoStack.length > 0,

    clear() {
      history.length = 0;
      redoStack.length = 0;
      pendingBefore = null;
      current = null;
    },
  };
}
