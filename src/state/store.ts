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
  GeometryFace,
  GeometryEdge,
  GeometryVertex,
  DomainType,
  Transform,
  UnitSystemName,
  SolverTargetName,
  MeshGlobalControls,
  MeshLocalControl,
  MeshQualityTargets,
  GeometryAsset,
  ResultIR,
} from '@/core/ir/types';
import { createDefaultProject } from '@/core/ir/defaults';
import { getUnitPreset } from '@/core/units/presets';
import { generateId } from '@/core/ir/id-generator';
import { createUndoRedoManager } from './middleware/undo-redo';
import { runValidation } from '@/validation/engine';
import { duplicateBodiesLinear as duplicateBodiesLinearInGeometry } from '@/geometry/editing';
import {
  deleteBodyCascade,
  deleteBoundaryConditionCascade,
  deleteInitialConditionCascade,
  deleteLoadCascade,
  deleteMaterialCascade,
  deleteNamedSelectionCascade,
  deleteSectionCascade,
} from '@/core/ir/relations';
import { clearSTLGeometryCache, removeSTLGeometry } from '@/geometry/import/stl-geometry-cache';

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
  mutateIR: (label: string, recipe: (ir: ProjectIR) => void) => void;
  setSolverTargetEnabled: (name: SolverTargetName, enabled: boolean) => void;

  // Geometry actions
  addBody: (body: GeometryBody) => void;
  addBodyWithTopology: (body: GeometryBody, topology: { faces?: GeometryFace[]; edges?: GeometryEdge[]; vertices?: GeometryVertex[]; assets?: GeometryAsset[] }) => void;
  updateBody: (id: string, updates: BodyUpdates) => void;
  removeBody: (id: string) => void;
  duplicateBodiesLinear: (ids: string[], copies: number, offset: [number, number, number]) => string[];

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
  setActiveAnalysisCase: (id: string) => void;
  removeAnalysisCase: (id: string) => void;
  addResult: (result: ResultIR) => void;
  removeResult: (id: string) => void;

  // Mesh actions
  updateGlobalMeshControls: (updates: Partial<MeshGlobalControls>) => void;
  addLocalMeshControl: (control: MeshLocalControl) => void;
  updateLocalMeshControl: (id: string, updates: Partial<MeshLocalControl>) => void;
  removeLocalMeshControl: (id: string) => void;
  updateMeshQualityTargets: (updates: Partial<MeshQualityTargets>) => void;

  // Validation
  runValidation: (target?: SolverTargetName, analysisCaseId?: string) => void;

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

export type BodyUpdates = Omit<Partial<GeometryBody>, 'transform'> & {
  transform?: Partial<Transform>;
};

// ---------------------------------------------------------------------------
// Undo/Redo manager (lives outside the store)
// ---------------------------------------------------------------------------

const undoRedoManager = createUndoRedoManager();

/** Call BEFORE mutating state.ir */
function saveBefore(state: AppState) {
  undoRedoManager.saveBefore(state.ir);
}

/** Call AFTER mutating state.ir — completes the undo entry */
function saveAfter(state: AppState) {
  state.ir.meta.updated_at = new Date().toISOString();
  state.ir.validation.model_revision += 1;
  undoRedoManager.saveAfter(state.ir);
  state.canUndo = undoRedoManager.canUndo();
  state.canRedo = undoRedoManager.canRedo();
}

/** Persist derived artifacts without invalidating the solver-input revision. */
function saveArtifactAfter(state: AppState) {
  state.ir.meta.updated_at = new Date().toISOString();
  undoRedoManager.saveAfter(state.ir);
  state.canUndo = undoRedoManager.canUndo();
  state.canRedo = undoRedoManager.canRedo();
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
        clearSTLGeometryCache();
        state.selectedEntityIds = [];
        state.hoveredEntityId = null;
        state.activePanel = 'geometry';
        state.isStartScreenOpen = false;
        undoRedoManager.clear();
        state.canUndo = false;
        state.canRedo = false;
      }),

    loadProject: (data) =>
      set((state) => {
        state.ir = data;
        clearSTLGeometryCache();
        state.selectedEntityIds = [];
        state.hoveredEntityId = null;
        state.activePanel = data.ui_state.active_panel || 'geometry';
        state.isStartScreenOpen = false;
        undoRedoManager.clear();
        state.canUndo = false;
        state.canRedo = false;
      }),

    setProjectName: (name) =>
      set((state) => {
        saveBefore(state);
        state.ir.meta.project_name = name;
        saveAfter(state);
      }),

    setUnitSystem: (name) =>
      set((state) => {
        if (state.ir.units.system_name === name) return;
        saveBefore(state);
        const previous = state.ir.units.system_name;
        state.ir.units = getUnitPreset(name);
        state.ir.audit_trail.push({
          id: generateId('audit'),
          timestamp: new Date().toISOString(),
          actor: 'user',
          action_type: 'unit_conversion',
          target_ref: 'units',
          before_summary: previous,
          after_summary: name,
          note: 'Changed display units; canonical SI values were preserved.',
        });
        saveAfter(state);
      }),

    mutateIR: (label, recipe) =>
      set((state) => {
        saveBefore(state);
        recipe(state.ir);
        state.ir.audit_trail.push({
          id: generateId('audit'),
          timestamp: new Date().toISOString(),
          actor: 'user',
          action_type: 'update',
          target_ref: 'project',
          before_summary: '',
          after_summary: label,
          note: label,
        });
        saveAfter(state);
      }),

    setSolverTargetEnabled: (name, enabled) =>
      set((state) => {
        const target = state.ir.solver_targets.find((item) => item.target_name === name);
        if (!target || target.enabled === enabled) return;
        saveBefore(state);
        target.enabled = enabled;
        saveAfter(state);
      }),

    // --- Geometry actions ---
    addBody: (body) =>
      set((state) => {
        saveBefore(state);
        state.ir.geometry.bodies.push(body);
        saveAfter(state);
      }),

    addBodyWithTopology: (body, topology) =>
      set((state) => {
        saveBefore(state);
        state.ir.geometry.bodies.push(body);
        if (topology.faces) state.ir.geometry.faces.push(...topology.faces);
        if (topology.edges) state.ir.geometry.edges.push(...topology.edges);
        if (topology.vertices) state.ir.geometry.vertices.push(...topology.vertices);
        if (topology.assets) {
          const existing = new Set(state.ir.assets.map((asset) => asset.id));
          state.ir.assets.push(...topology.assets.filter((asset) => !existing.has(asset.id)));
          state.ir.geometry.source = 'imported_stl';
        }
        saveAfter(state);
      }),

    updateBody: (id, updates) =>
      set((state) => {
        const idx = state.ir.geometry.bodies.findIndex((body) => body.id === id);
        if (idx < 0) {
          return;
        }

        saveBefore(state);
        const currentBody = state.ir.geometry.bodies[idx];
        const { transform, ...bodyUpdates } = updates;
        Object.assign(currentBody, bodyUpdates);
        if (transform) {
          currentBody.transform = {
            ...currentBody.transform,
            ...transform,
          };
        }
        saveAfter(state);
      }),

    removeBody: (id) =>
      set((state) => {
        saveBefore(state);
        removeSTLGeometry(id);
        deleteBodyCascade(state.ir, id);
        const referencedAssets = new Set(state.ir.geometry.bodies.map((body) => body.asset_ref).filter(Boolean));
        state.ir.assets = state.ir.assets.filter((asset) => referencedAssets.has(asset.id));
        saveAfter(state);
      }),

    duplicateBodiesLinear: (ids, copies, offset) => {
      let createdBodyIds: string[] = [];

      set((state) => {
        const duplicated = duplicateBodiesLinearInGeometry(
          state.ir.geometry,
          ids,
          copies,
          offset,
        );

        if (duplicated.createdBodyIds.length === 0) {
          return;
        }

        saveBefore(state);
        state.ir.geometry.bodies.push(...duplicated.bodies);
        state.ir.geometry.faces.push(...duplicated.faces);
        state.ir.geometry.edges.push(...duplicated.edges);
        state.ir.geometry.vertices.push(...duplicated.vertices);
        saveAfter(state);
        createdBodyIds = duplicated.createdBodyIds;
      });

      return createdBodyIds;
    },

    // --- Named selection actions ---
    addNamedSelection: (ns) =>
      set((state) => {
        saveBefore(state);
        state.ir.named_selections.push(ns);
        saveAfter(state);
      }),

    updateNamedSelection: (id, updates) =>
      set((state) => {
        const idx = state.ir.named_selections.findIndex((n) => n.id === id);
        if (idx >= 0) {
          saveBefore(state);
          Object.assign(state.ir.named_selections[idx], updates);
          saveAfter(state);
        }
      }),

    removeNamedSelection: (id) =>
      set((state) => {
        saveBefore(state);
        deleteNamedSelectionCascade(state.ir, id);
        saveAfter(state);
      }),

    // --- Material actions ---
    addMaterial: (mat) =>
      set((state) => {
        saveBefore(state);
        state.ir.materials.push(mat);
        saveAfter(state);
      }),

    updateMaterial: (id, updates) =>
      set((state) => {
        const idx = state.ir.materials.findIndex((m) => m.id === id);
        if (idx >= 0) {
          saveBefore(state);
          Object.assign(state.ir.materials[idx], updates);
          saveAfter(state);
        }
      }),

    removeMaterial: (id) =>
      set((state) => {
        saveBefore(state);
        deleteMaterialCascade(state.ir, id);
        saveAfter(state);
      }),

    addMaterialAssignment: (a) =>
      set((state) => {
        saveBefore(state);
        state.ir.material_assignments = state.ir.material_assignments.filter(
          (item) => item.target_named_selection_id !== a.target_named_selection_id,
        );
        state.ir.material_assignments.push(a);
        saveAfter(state);
      }),

    removeMaterialAssignment: (id) =>
      set((state) => {
        saveBefore(state);
        state.ir.material_assignments = state.ir.material_assignments.filter(
          (a) => a.id !== id,
        );
        saveAfter(state);
      }),

    // --- Section actions ---
    addSection: (sec) =>
      set((state) => {
        saveBefore(state);
        state.ir.sections.push(sec);
        saveAfter(state);
      }),

    updateSection: (id, updates) =>
      set((state) => {
        const idx = state.ir.sections.findIndex((s) => s.id === id);
        if (idx >= 0) {
          saveBefore(state);
          Object.assign(state.ir.sections[idx], updates);
          saveAfter(state);
        }
      }),

    removeSection: (id) =>
      set((state) => {
        saveBefore(state);
        deleteSectionCascade(state.ir, id);
        saveAfter(state);
      }),

    addSectionAssignment: (a) =>
      set((state) => {
        saveBefore(state);
        state.ir.section_assignments = state.ir.section_assignments.filter(
          (item) => item.target_named_selection_id !== a.target_named_selection_id,
        );
        state.ir.section_assignments.push(a);
        saveAfter(state);
      }),

    removeSectionAssignment: (id) =>
      set((state) => {
        saveBefore(state);
        state.ir.section_assignments = state.ir.section_assignments.filter(
          (a) => a.id !== id,
        );
        saveAfter(state);
      }),

    // --- Boundary condition actions ---
    addBoundaryCondition: (bc) =>
      set((state) => {
        saveBefore(state);
        state.ir.boundary_conditions.push(bc);
        saveAfter(state);
      }),

    updateBoundaryCondition: (id, updates) =>
      set((state) => {
        const idx = state.ir.boundary_conditions.findIndex((b) => b.id === id);
        if (idx >= 0) {
          saveBefore(state);
          Object.assign(state.ir.boundary_conditions[idx], updates);
          saveAfter(state);
        }
      }),

    removeBoundaryCondition: (id) =>
      set((state) => {
        saveBefore(state);
        deleteBoundaryConditionCascade(state.ir, id);
        saveAfter(state);
      }),

    // --- Load actions ---
    addLoad: (load) =>
      set((state) => {
        saveBefore(state);
        state.ir.loads.push(load);
        saveAfter(state);
      }),

    updateLoad: (id, updates) =>
      set((state) => {
        const idx = state.ir.loads.findIndex((l) => l.id === id);
        if (idx >= 0) {
          saveBefore(state);
          Object.assign(state.ir.loads[idx], updates);
          saveAfter(state);
        }
      }),

    removeLoad: (id) =>
      set((state) => {
        saveBefore(state);
        deleteLoadCascade(state.ir, id);
        saveAfter(state);
      }),

    // --- Initial condition actions ---
    addInitialCondition: (ic) =>
      set((state) => {
        saveBefore(state);
        state.ir.initial_conditions.push(ic);
        saveAfter(state);
      }),

    removeInitialCondition: (id) =>
      set((state) => {
        saveBefore(state);
        deleteInitialConditionCascade(state.ir, id);
        saveAfter(state);
      }),

    // --- Analysis case actions ---
    addAnalysisCase: (ac) =>
      set((state) => {
        saveBefore(state);
        if (ac.active) {
          for (const item of state.ir.analysis_cases) item.active = false;
        }
        state.ir.analysis_cases.push(ac);
        saveAfter(state);
      }),

    updateAnalysisCase: (id, updates) =>
      set((state) => {
        const idx = state.ir.analysis_cases.findIndex((c) => c.id === id);
        if (idx >= 0) {
          saveBefore(state);
          if (updates.active === true) {
            for (const item of state.ir.analysis_cases) item.active = false;
          }
          Object.assign(state.ir.analysis_cases[idx], updates);
          saveAfter(state);
        }
      }),

    setActiveAnalysisCase: (id) =>
      set((state) => {
        if (!state.ir.analysis_cases.some((item) => item.id === id)) return;
        if (state.ir.analysis_cases.every((item) => item.active === (item.id === id))) return;
        saveBefore(state);
        for (const item of state.ir.analysis_cases) item.active = item.id === id;
        saveAfter(state);
      }),

    removeAnalysisCase: (id) =>
      set((state) => {
        const removedWasActive = state.ir.analysis_cases.some((item) => item.id === id && item.active);
        saveBefore(state);
        state.ir.analysis_cases = state.ir.analysis_cases.filter((c) => c.id !== id);
        if (removedWasActive && state.ir.analysis_cases.length > 0) {
          state.ir.analysis_cases[0].active = true;
        }
        state.ir.results = state.ir.results.filter((result) => result.analysis_case_id !== id);
        saveAfter(state);
      }),

    addResult: (result) =>
      set((state) => {
        saveBefore(state);
        state.ir.results.push(result);
        saveArtifactAfter(state);
      }),

    removeResult: (id) =>
      set((state) => {
        saveBefore(state);
        state.ir.results = state.ir.results.filter((result) => result.id !== id);
        saveArtifactAfter(state);
      }),

    // --- Mesh actions ---
    updateGlobalMeshControls: (updates) =>
      set((state) => {
        saveBefore(state);
        Object.assign(state.ir.mesh_controls.global, updates);
        saveAfter(state);
      }),

    addLocalMeshControl: (control) =>
      set((state) => {
        saveBefore(state);
        state.ir.mesh_controls.local.push(control);
        saveAfter(state);
      }),

    updateLocalMeshControl: (id, updates) =>
      set((state) => {
        const control = state.ir.mesh_controls.local.find((item) => item.id === id);
        if (!control) return;
        saveBefore(state);
        Object.assign(control, updates);
        saveAfter(state);
      }),

    removeLocalMeshControl: (id) =>
      set((state) => {
        saveBefore(state);
        state.ir.mesh_controls.local = state.ir.mesh_controls.local.filter((item) => item.id !== id);
        saveAfter(state);
      }),

    updateMeshQualityTargets: (updates) =>
      set((state) => {
        saveBefore(state);
        Object.assign(state.ir.mesh_controls.quality_targets, updates);
        saveAfter(state);
      }),

    // --- Validation ---
    runValidation: (target, analysisCaseId) =>
      set((state) => {
        state.ir.validation = runValidation(state.ir, target, analysisCaseId);
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
