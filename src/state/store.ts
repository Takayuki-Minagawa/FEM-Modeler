import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type {
  ProjectIR,
  NamedSelection,
  Material,
  MaterialAssignment,
  Section,
  SectionAssignment,
  BoundaryCondition,
  Load,
  InitialCondition,
  AnalysisCase,
  GeometryBody,
  DomainType,
  UnitSystemName,
} from '@/core/ir/types';
import { createDefaultProject } from '@/core/ir/defaults';
import { getUnitPreset } from '@/core/units/presets';
import { generateId } from '@/core/ir/id-generator';
import { createUndoRedoManager } from './middleware/undo-redo';

// ---------------------------------------------------------------------------
// Transient UI state (not persisted in project JSON)
// ---------------------------------------------------------------------------

export type PickFilterType = 'body' | 'face' | 'edge' | 'vertex';
export type DisplayMode = 'beginner' | 'expert';
export type ViewMode = 'shaded' | 'wireframe' | 'transparent';

export interface TransientState {
  activePanel: string;
  hoveredEntityId: string | null;
  selectedEntityIds: string[];
  pickFilter: PickFilterType;
  displayMode: DisplayMode;
  viewMode: ViewMode;
  showGrid: boolean;
  showAxes: boolean;
  isStartScreenOpen: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

export interface AppState extends TransientState {
  ir: ProjectIR;

  // Project actions
  createProject: (name?: string, domain?: DomainType) => void;
  loadProject: (data: ProjectIR) => void;
  setProjectName: (name: string) => void;
  setUnitSystem: (name: UnitSystemName) => void;

  // Geometry actions
  addBody: (body: GeometryBody) => void;
  removeBody: (id: string) => void;

  // Named selection actions
  addNamedSelection: (ns: NamedSelection) => void;
  updateNamedSelection: (id: string, updates: Partial<NamedSelection>) => void;
  removeNamedSelection: (id: string) => void;

  // Material actions
  addMaterial: (mat: Material) => void;
  updateMaterial: (id: string, updates: Partial<Material>) => void;
  removeMaterial: (id: string) => void;
  addMaterialAssignment: (a: MaterialAssignment) => void;
  removeMaterialAssignment: (id: string) => void;

  // Section actions
  addSection: (sec: Section) => void;
  updateSection: (id: string, updates: Partial<Section>) => void;
  removeSection: (id: string) => void;
  addSectionAssignment: (a: SectionAssignment) => void;
  removeSectionAssignment: (id: string) => void;

  // Boundary condition actions
  addBoundaryCondition: (bc: BoundaryCondition) => void;
  updateBoundaryCondition: (id: string, updates: Partial<BoundaryCondition>) => void;
  removeBoundaryCondition: (id: string) => void;

  // Load actions
  addLoad: (load: Load) => void;
  updateLoad: (id: string, updates: Partial<Load>) => void;
  removeLoad: (id: string) => void;

  // Initial condition actions
  addInitialCondition: (ic: InitialCondition) => void;
  removeInitialCondition: (id: string) => void;

  // Analysis case actions
  addAnalysisCase: (ac: AnalysisCase) => void;
  updateAnalysisCase: (id: string, updates: Partial<AnalysisCase>) => void;
  removeAnalysisCase: (id: string) => void;

  // Undo/Redo
  undo: () => void;
  redo: () => void;

  // UI actions (transient, not tracked by undo)
  setActivePanel: (panel: string) => void;
  setHoveredEntity: (id: string | null) => void;
  setSelectedEntities: (ids: string[]) => void;
  toggleEntitySelection: (id: string) => void;
  setPickFilter: (filter: PickFilterType) => void;
  setDisplayMode: (mode: DisplayMode) => void;
  setViewMode: (mode: ViewMode) => void;
  toggleGrid: () => void;
  toggleAxes: () => void;
  setStartScreenOpen: (open: boolean) => void;
}

// ---------------------------------------------------------------------------
// Undo/Redo manager (lives outside the store)
// ---------------------------------------------------------------------------

const undoRedoManager = createUndoRedoManager();

function snapshot(state: AppState) {
  undoRedoManager.pushState(state.ir);
  state.canUndo = undoRedoManager.canUndo();
  state.canRedo = undoRedoManager.canRedo();
}

function touch(state: AppState) {
  state.ir.meta.updated_at = new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Store implementation
// ---------------------------------------------------------------------------

export const useAppStore = create<AppState>()(
  immer((set) => ({
    // Initial transient state
    activePanel: 'geometry',
    hoveredEntityId: null,
    selectedEntityIds: [],
    pickFilter: 'body' as PickFilterType,
    displayMode: 'beginner' as DisplayMode,
    viewMode: 'shaded' as ViewMode,
    showGrid: true,
    showAxes: true,
    isStartScreenOpen: true,
    canUndo: false,
    canRedo: false,

    // Initial IR
    ir: createDefaultProject(),

    // --- Project actions ---
    createProject: (name, domain) =>
      set((state) => {
        const ir = createDefaultProject();
        if (name) ir.meta.project_name = name;
        if (domain) ir.meta.domain_type = domain;
        state.ir = ir;
        state.isStartScreenOpen = false;
        undoRedoManager.clear();
        snapshot(state);
      }),

    loadProject: (data) =>
      set((state) => {
        state.ir = data;
        state.isStartScreenOpen = false;
        undoRedoManager.clear();
        snapshot(state);
      }),

    setProjectName: (name) =>
      set((state) => {
        snapshot(state);
        state.ir.meta.project_name = name;
        touch(state);
      }),

    setUnitSystem: (name) =>
      set((state) => {
        snapshot(state);
        state.ir.units = getUnitPreset(name);
        touch(state);
      }),

    // --- Geometry actions ---
    addBody: (body) =>
      set((state) => {
        snapshot(state);
        state.ir.geometry.bodies.push(body);
        touch(state);
      }),

    removeBody: (id) =>
      set((state) => {
        snapshot(state);
        state.ir.geometry.bodies = state.ir.geometry.bodies.filter((b) => b.id !== id);
        state.ir.geometry.faces = state.ir.geometry.faces.filter((f) => f.body_id !== id);
        state.ir.geometry.edges = state.ir.geometry.edges.filter((e) => e.body_id !== id);
        state.ir.geometry.vertices = state.ir.geometry.vertices.filter((v) => v.body_id !== id);
        touch(state);
      }),

    // --- Named selection actions ---
    addNamedSelection: (ns) =>
      set((state) => {
        snapshot(state);
        state.ir.named_selections.push(ns);
        touch(state);
      }),

    updateNamedSelection: (id, updates) =>
      set((state) => {
        const idx = state.ir.named_selections.findIndex((n) => n.id === id);
        if (idx >= 0) {
          snapshot(state);
          Object.assign(state.ir.named_selections[idx], updates);
          touch(state);
        }
      }),

    removeNamedSelection: (id) =>
      set((state) => {
        snapshot(state);
        state.ir.named_selections = state.ir.named_selections.filter((n) => n.id !== id);
        touch(state);
      }),

    // --- Material actions ---
    addMaterial: (mat) =>
      set((state) => {
        snapshot(state);
        state.ir.materials.push(mat);
        touch(state);
      }),

    updateMaterial: (id, updates) =>
      set((state) => {
        const idx = state.ir.materials.findIndex((m) => m.id === id);
        if (idx >= 0) {
          snapshot(state);
          Object.assign(state.ir.materials[idx], updates);
          touch(state);
        }
      }),

    removeMaterial: (id) =>
      set((state) => {
        snapshot(state);
        state.ir.materials = state.ir.materials.filter((m) => m.id !== id);
        state.ir.material_assignments = state.ir.material_assignments.filter(
          (a) => a.material_id !== id,
        );
        touch(state);
      }),

    addMaterialAssignment: (a) =>
      set((state) => {
        snapshot(state);
        state.ir.material_assignments.push(a);
        touch(state);
      }),

    removeMaterialAssignment: (id) =>
      set((state) => {
        snapshot(state);
        state.ir.material_assignments = state.ir.material_assignments.filter(
          (a) => a.id !== id,
        );
        touch(state);
      }),

    // --- Section actions ---
    addSection: (sec) =>
      set((state) => {
        snapshot(state);
        state.ir.sections.push(sec);
        touch(state);
      }),

    updateSection: (id, updates) =>
      set((state) => {
        const idx = state.ir.sections.findIndex((s) => s.id === id);
        if (idx >= 0) {
          snapshot(state);
          Object.assign(state.ir.sections[idx], updates);
          touch(state);
        }
      }),

    removeSection: (id) =>
      set((state) => {
        snapshot(state);
        state.ir.sections = state.ir.sections.filter((s) => s.id !== id);
        state.ir.section_assignments = state.ir.section_assignments.filter(
          (a) => a.section_id !== id,
        );
        touch(state);
      }),

    addSectionAssignment: (a) =>
      set((state) => {
        snapshot(state);
        state.ir.section_assignments.push(a);
        touch(state);
      }),

    removeSectionAssignment: (id) =>
      set((state) => {
        snapshot(state);
        state.ir.section_assignments = state.ir.section_assignments.filter(
          (a) => a.id !== id,
        );
        touch(state);
      }),

    // --- Boundary condition actions ---
    addBoundaryCondition: (bc) =>
      set((state) => {
        snapshot(state);
        state.ir.boundary_conditions.push(bc);
        touch(state);
      }),

    updateBoundaryCondition: (id, updates) =>
      set((state) => {
        const idx = state.ir.boundary_conditions.findIndex((b) => b.id === id);
        if (idx >= 0) {
          snapshot(state);
          Object.assign(state.ir.boundary_conditions[idx], updates);
          touch(state);
        }
      }),

    removeBoundaryCondition: (id) =>
      set((state) => {
        snapshot(state);
        state.ir.boundary_conditions = state.ir.boundary_conditions.filter(
          (b) => b.id !== id,
        );
        touch(state);
      }),

    // --- Load actions ---
    addLoad: (load) =>
      set((state) => {
        snapshot(state);
        state.ir.loads.push(load);
        touch(state);
      }),

    updateLoad: (id, updates) =>
      set((state) => {
        const idx = state.ir.loads.findIndex((l) => l.id === id);
        if (idx >= 0) {
          snapshot(state);
          Object.assign(state.ir.loads[idx], updates);
          touch(state);
        }
      }),

    removeLoad: (id) =>
      set((state) => {
        snapshot(state);
        state.ir.loads = state.ir.loads.filter((l) => l.id !== id);
        touch(state);
      }),

    // --- Initial condition actions ---
    addInitialCondition: (ic) =>
      set((state) => {
        snapshot(state);
        state.ir.initial_conditions.push(ic);
        touch(state);
      }),

    removeInitialCondition: (id) =>
      set((state) => {
        snapshot(state);
        state.ir.initial_conditions = state.ir.initial_conditions.filter(
          (ic) => ic.id !== id,
        );
        touch(state);
      }),

    // --- Analysis case actions ---
    addAnalysisCase: (ac) =>
      set((state) => {
        snapshot(state);
        state.ir.analysis_cases.push(ac);
        touch(state);
      }),

    updateAnalysisCase: (id, updates) =>
      set((state) => {
        const idx = state.ir.analysis_cases.findIndex((c) => c.id === id);
        if (idx >= 0) {
          snapshot(state);
          Object.assign(state.ir.analysis_cases[idx], updates);
          touch(state);
        }
      }),

    removeAnalysisCase: (id) =>
      set((state) => {
        snapshot(state);
        state.ir.analysis_cases = state.ir.analysis_cases.filter((c) => c.id !== id);
        touch(state);
      }),

    // --- Undo/Redo ---
    undo: () =>
      set((state) => {
        const prev = undoRedoManager.undo();
        if (prev) {
          state.ir = prev;
          state.canUndo = undoRedoManager.canUndo();
          state.canRedo = undoRedoManager.canRedo();
        }
      }),

    redo: () =>
      set((state) => {
        const next = undoRedoManager.redo();
        if (next) {
          state.ir = next;
          state.canUndo = undoRedoManager.canUndo();
          state.canRedo = undoRedoManager.canRedo();
        }
      }),

    // --- UI actions (transient, not tracked by undo) ---
    setActivePanel: (panel) => set({ activePanel: panel }),
    setHoveredEntity: (id) => set({ hoveredEntityId: id }),
    setSelectedEntities: (ids) => set({ selectedEntityIds: ids }),
    toggleEntitySelection: (id) =>
      set((state) => {
        const idx = state.selectedEntityIds.indexOf(id);
        if (idx >= 0) {
          state.selectedEntityIds.splice(idx, 1);
        } else {
          state.selectedEntityIds.push(id);
        }
      }),
    setPickFilter: (filter) => set({ pickFilter: filter }),
    setDisplayMode: (mode) => set({ displayMode: mode }),
    setViewMode: (mode) => set({ viewMode: mode }),
    toggleGrid: () =>
      set((state) => {
        state.showGrid = !state.showGrid;
      }),
    toggleAxes: () =>
      set((state) => {
        state.showAxes = !state.showAxes;
      }),
    setStartScreenOpen: (open) => set({ isStartScreenOpen: open }),
  })),
);

// Convenience selectors
export const selectIR = (state: AppState) => state.ir;
export const selectMeta = (state: AppState) => state.ir.meta;
export const selectUnits = (state: AppState) => state.ir.units;
export const selectGeometry = (state: AppState) => state.ir.geometry;
export const selectNamedSelections = (state: AppState) => state.ir.named_selections;
export const selectMaterials = (state: AppState) => state.ir.materials;
export const selectSections = (state: AppState) => state.ir.sections;
export const selectBoundaryConditions = (state: AppState) => state.ir.boundary_conditions;
export const selectLoads = (state: AppState) => state.ir.loads;
export const selectAnalysisCases = (state: AppState) => state.ir.analysis_cases;
export const selectValidation = (state: AppState) => state.ir.validation;

export { generateId };
