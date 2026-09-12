import { create } from 'zustand';
import type { Vector3Tuple } from '@/geometry/transforms';

interface ViewState {
  showConditions: boolean;
  showMaterials: boolean;
  resultId: string;
  fieldId: string;
  deformationScale: number;
  badElementsOnly: boolean;
  focus: { points: Vector3Tuple[]; serial: number } | null;
  probe: { id: string; position: Vector3Tuple; value: number | null; unit: string } | null;
  set: (updates: Partial<Omit<ViewState, 'set' | 'focusPoints'>>) => void;
  focusPoints: (points: Vector3Tuple[]) => void;
}
export const useViewerState = create<ViewState>((set) => ({
  showConditions: false, showMaterials: false, resultId: '', fieldId: '', deformationScale: 1,
  badElementsOnly: false, focus: null, probe: null,
  set: (updates) => set({ ...updates, ...(updates.resultId ? { showConditions: false, showMaterials: false } : {}) }),
  focusPoints: (points) => set((state) => ({ focus: { points, serial: (state.focus?.serial ?? 0) + 1 } })),
}));
