import { create } from 'zustand';
import { produce, produceWithPatches, type Draft } from 'immer';
import { createModelActions, type ProjectEditor } from './slices/model-actions';
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
import { generateId } from '@/core/ir/id-generator';
import { createUndoRedoManager } from './middleware/undo-redo';
import { clearSTLGeometryCache } from '@/geometry/import/stl-geometry-cache';

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
  /** Changes only when the user explicitly creates, opens, restores, or starts editing. */
  projectSession: number;
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
  mutateArtifact: (label: string, recipe: (ir: ProjectIR) => void) => void;
  setSolverTargetEnabled: (name: SolverTargetName, enabled: boolean) => void;

  // Geometry actions
  addBody: (body: GeometryBody) => void;
  addBodyWithTopology: (body: GeometryBody, topology: { faces?: GeometryFace[]; edges?: GeometryEdge[]; vertices?: GeometryVertex[]; assets?: GeometryAsset[] }) => void;
  updateBody: (id: string, updates: BodyUpdates) => void;
  removeBody: (id: string) => void;
  removeBodies: (ids: string[]) => void;
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

export const getHistoryStats = () => undoRedoManager.stats();

function reconcileSelection(state: Draft<AppState>) {
  const geometry = state.ir.geometry;
  const valid = new Set([...geometry.bodies, ...geometry.faces, ...geometry.edges, ...geometry.vertices].map((entity) => entity.id));
  state.selectedEntityIds = state.selectedEntityIds.filter((id) => valid.has(id));
  if (state.hoveredEntityId && !valid.has(state.hoveredEntityId)) state.hoveredEntityId = null;
}

// ---------------------------------------------------------------------------
// Store implementation
// ---------------------------------------------------------------------------

export const useAppStore = create<AppState>()((rawSet) => {
  const set = (update: Partial<AppState> | ((state: Draft<AppState>) => void)) => {
    if (typeof update === 'function') rawSet((state) => produce(state, update));
    else rawSet(update);
  };
  const edit: ProjectEditor = (recipe, kind = 'model') => rawSet((state) => {
    const [next, patches, inverse] = produceWithPatches(state, (draft) => {
      recipe(draft);
    });
    const irPatches = patches.filter((patch) => patch.path[0] === 'ir');
    if (!irPatches.length) return next;
    // Finalize metadata inside the same transaction without copying unmodified IR branches.
    const [updated, metaPatches, metaInverse] = produceWithPatches(next, (draft) => {
      if (kind === 'derived') return;
      draft.ir.meta.updated_at = new Date().toISOString();
      if (kind === 'model') draft.ir.validation.model_revision += 1;
    });
    if (kind !== 'derived') undoRedoManager.record(
      [...irPatches, ...metaPatches].map((patch) => ({ ...patch, path: patch.path.slice(1) })),
      [...metaInverse, ...inverse.filter((patch) => patch.path[0] === 'ir')].map((patch) => ({ ...patch, path: patch.path.slice(1) })),
    );
    return { ...updated, canUndo: undoRedoManager.canUndo(), canRedo: undoRedoManager.canRedo() };
  });
  return {
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
    projectSession: 0,

    // Initial IR
    ir: createDefaultProject(),

    // --- Project actions ---
    createProject: (name, domain) =>
      set((state) => {
        const ir = createDefaultProject();
        if (name) ir.meta.project_name = name;
        if (domain) ir.meta.domain_type = domain;
        state.projectSession += 1;
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
        state.projectSession += 1;
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

    ...createModelActions(edit),

    // --- Undo/Redo ---
    undo: () =>
      set((state) => {
        const prev = undoRedoManager.undo(state.ir);
        if (prev) {
          state.ir = prev;
          reconcileSelection(state);
          state.canUndo = undoRedoManager.canUndo();
          state.canRedo = undoRedoManager.canRedo();
        }
      }),

    redo: () =>
      set((state) => {
        const next = undoRedoManager.redo(state.ir);
        if (next) {
          state.ir = next;
          reconcileSelection(state);
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
    setStartScreenOpen: (open) => set((state) => {
      state.isStartScreenOpen = open;
      if (!open && state.projectSession === 0) state.projectSession = 1;
    }),
  };
});

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
