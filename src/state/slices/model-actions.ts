import type { Draft } from 'immer';
import type { AppState } from '../store';
import { getUnitPreset } from '@/core/units/presets';
import { generateId } from '@/core/ir/id-generator';
import { runValidation } from '@/validation/engine';
import { duplicateBodiesLinear as duplicateBodiesLinearInGeometry } from '@/geometry/editing';
import { deleteBodyCascade, deleteBoundaryConditionCascade, deleteInitialConditionCascade, deleteLoadCascade, deleteMaterialCascade, deleteNamedSelectionCascade, deleteSectionCascade } from '@/core/ir/relations';
import { removeSTLGeometry } from '@/geometry/import/stl-geometry-cache';

export type EditKind = 'model' | 'display' | 'artifact' | 'derived';
export type ProjectEditor = (recipe: (state: Draft<AppState>) => void, kind?: EditKind) => void;

export function createModelActions(edit: ProjectEditor) {
  const removeBodies = (ids: string[]) => edit((state) => {
    const existing = new Set(state.ir.geometry.bodies.map((body) => body.id));
    const removed = [...new Set(ids)].filter((id) => existing.has(id));
    if (!removed.length) return;
    for (const id of removed) { removeSTLGeometry(id); deleteBodyCascade(state.ir, id); }
    const assets = new Set(state.ir.geometry.bodies.map((body) => body.asset_ref).filter(Boolean));
    state.ir.assets = state.ir.assets.filter((asset) => assets.has(asset.id));
    const remaining = new Set([...state.ir.geometry.bodies, ...state.ir.geometry.faces, ...state.ir.geometry.edges, ...state.ir.geometry.vertices].map((entity) => entity.id));
    state.selectedEntityIds = state.selectedEntityIds.filter((id) => remaining.has(id));
    if (state.hoveredEntityId && !remaining.has(state.hoveredEntityId)) state.hoveredEntityId = null;
  });
  return {
    setProjectName: (name) =>
      edit((state) => {
        state.ir.meta.project_name = name;
      }, 'display'),

    setUnitSystem: (name) =>
      edit((state) => {
        if (state.ir.units.system_name === name) return;
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
      }, 'display'),

    mutateIR: (label, recipe) =>
      edit((state) => {
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
      }),

    mutateArtifact: (label, recipe) => edit((state) => {
      recipe(state.ir);
      state.ir.audit_trail.push({ id: generateId('audit'), timestamp: new Date().toISOString(), actor: 'user', action_type: 'update', target_ref: 'artifacts', before_summary: '', after_summary: label, note: label });
    }, 'artifact'),

    setSolverTargetEnabled: (name, enabled) =>
      edit((state) => {
        const target = state.ir.solver_targets.find((item) => item.target_name === name);
        if (!target || target.enabled === enabled) return;
        target.enabled = enabled;
      }),

    // --- Geometry actions ---
    addBody: (body) =>
      edit((state) => {
        state.ir.geometry.bodies.push(body);
      }),

    addBodyWithTopology: (body, topology) =>
      edit((state) => {
        state.ir.geometry.bodies.push(body);
        if (topology.faces) state.ir.geometry.faces.push(...topology.faces);
        if (topology.edges) state.ir.geometry.edges.push(...topology.edges);
        if (topology.vertices) state.ir.geometry.vertices.push(...topology.vertices);
        if (topology.assets) {
          const existing = new Set(state.ir.assets.map((asset) => asset.id));
          state.ir.assets.push(...topology.assets.filter((asset) => !existing.has(asset.id)));
          state.ir.geometry.source = body.metadata.shapeType === 'imported_cad'
            ? body.metadata.importFormat === 'iges' ? 'imported_iges' : 'imported_step'
            : 'imported_stl';
        }
      }),

    updateBody: (id, updates) =>
      edit((state) => {
        const idx = state.ir.geometry.bodies.findIndex((body) => body.id === id);
        if (idx < 0) {
          return;
        }
        const currentBody = state.ir.geometry.bodies[idx];
        const { transform, ...bodyUpdates } = updates;
        Object.assign(currentBody, bodyUpdates);
        if (transform) {
          currentBody.transform = {
            ...currentBody.transform,
            ...transform,
          };
        }
      }),

    removeBody: (id) => removeBodies([id]),
    removeBodies,

    duplicateBodiesLinear: (ids, copies, offset) => {
      let createdBodyIds: string[] = [];

      edit((state) => {
        const duplicated = duplicateBodiesLinearInGeometry(
          state.ir.geometry,
          ids,
          copies,
          offset,
        );

        if (duplicated.createdBodyIds.length === 0) {
          return;
        }
        state.ir.geometry.bodies.push(...duplicated.bodies);
        state.ir.geometry.faces.push(...duplicated.faces);
        state.ir.geometry.edges.push(...duplicated.edges);
        state.ir.geometry.vertices.push(...duplicated.vertices);
        createdBodyIds = duplicated.createdBodyIds;
      });

      return createdBodyIds;
    },

    // --- Named selection actions ---
    addNamedSelection: (ns) =>
      edit((state) => {
        state.ir.named_selections.push(ns);
      }),

    updateNamedSelection: (id, updates) =>
      edit((state) => {
        const idx = state.ir.named_selections.findIndex((n) => n.id === id);
        if (idx >= 0) {
          Object.assign(state.ir.named_selections[idx], updates);
        }
      }),

    removeNamedSelection: (id) =>
      edit((state) => {
        deleteNamedSelectionCascade(state.ir, id);
      }),

    // --- Material actions ---
    addMaterial: (mat) =>
      edit((state) => {
        state.ir.materials.push(mat);
      }),

    updateMaterial: (id, updates) =>
      edit((state) => {
        const idx = state.ir.materials.findIndex((m) => m.id === id);
        if (idx >= 0) {
          Object.assign(state.ir.materials[idx], updates);
        }
      }),

    removeMaterial: (id) =>
      edit((state) => {
        deleteMaterialCascade(state.ir, id);
      }),

    addMaterialAssignment: (a) =>
      edit((state) => {
        state.ir.material_assignments = state.ir.material_assignments.filter(
          (item) => item.target_named_selection_id !== a.target_named_selection_id,
        );
        state.ir.material_assignments.push(a);
      }),

    removeMaterialAssignment: (id) =>
      edit((state) => {
        state.ir.material_assignments = state.ir.material_assignments.filter(
          (a) => a.id !== id,
        );
      }),

    // --- Section actions ---
    addSection: (sec) =>
      edit((state) => {
        state.ir.sections.push(sec);
      }),

    updateSection: (id, updates) =>
      edit((state) => {
        const idx = state.ir.sections.findIndex((s) => s.id === id);
        if (idx >= 0) {
          Object.assign(state.ir.sections[idx], updates);
        }
      }),

    removeSection: (id) =>
      edit((state) => {
        deleteSectionCascade(state.ir, id);
      }),

    addSectionAssignment: (a) =>
      edit((state) => {
        state.ir.section_assignments = state.ir.section_assignments.filter(
          (item) => item.target_named_selection_id !== a.target_named_selection_id,
        );
        state.ir.section_assignments.push(a);
      }),

    removeSectionAssignment: (id) =>
      edit((state) => {
        state.ir.section_assignments = state.ir.section_assignments.filter(
          (a) => a.id !== id,
        );
      }),

    // --- Boundary condition actions ---
    addBoundaryCondition: (bc) =>
      edit((state) => {
        state.ir.boundary_conditions.push(bc);
      }),

    updateBoundaryCondition: (id, updates) =>
      edit((state) => {
        const idx = state.ir.boundary_conditions.findIndex((b) => b.id === id);
        if (idx >= 0) {
          Object.assign(state.ir.boundary_conditions[idx], updates);
        }
      }),

    removeBoundaryCondition: (id) =>
      edit((state) => {
        deleteBoundaryConditionCascade(state.ir, id);
      }),

    // --- Load actions ---
    addLoad: (load) =>
      edit((state) => {
        state.ir.loads.push(load);
      }),

    updateLoad: (id, updates) =>
      edit((state) => {
        const idx = state.ir.loads.findIndex((l) => l.id === id);
        if (idx >= 0) {
          Object.assign(state.ir.loads[idx], updates);
        }
      }),

    removeLoad: (id) =>
      edit((state) => {
        deleteLoadCascade(state.ir, id);
      }),

    // --- Initial condition actions ---
    addInitialCondition: (ic) =>
      edit((state) => {
        state.ir.initial_conditions.push(ic);
      }),

    removeInitialCondition: (id) =>
      edit((state) => {
        deleteInitialConditionCascade(state.ir, id);
      }),

    // --- Analysis case actions ---
    addAnalysisCase: (ac) =>
      edit((state) => {
        if (ac.active) {
          for (const item of state.ir.analysis_cases) item.active = false;
        }
        state.ir.analysis_cases.push(ac);
      }),

    updateAnalysisCase: (id, updates) =>
      edit((state) => {
        const idx = state.ir.analysis_cases.findIndex((c) => c.id === id);
        if (idx >= 0) {
          if (updates.active === true) {
            for (const item of state.ir.analysis_cases) item.active = false;
          }
          Object.assign(state.ir.analysis_cases[idx], updates);
        }
      }),

    setActiveAnalysisCase: (id) =>
      edit((state) => {
        if (!state.ir.analysis_cases.some((item) => item.id === id)) return;
        if (state.ir.analysis_cases.every((item) => item.active === (item.id === id))) return;
        for (const item of state.ir.analysis_cases) item.active = item.id === id;
      }),

    removeAnalysisCase: (id) =>
      edit((state) => {
        const removedWasActive = state.ir.analysis_cases.some((item) => item.id === id && item.active);
        state.ir.analysis_cases = state.ir.analysis_cases.filter((c) => c.id !== id);
        if (removedWasActive && state.ir.analysis_cases.length > 0) {
          state.ir.analysis_cases[0].active = true;
        }
        state.ir.results = state.ir.results.filter((result) => result.analysis_case_id !== id);
        state.ir.convergence_studies = state.ir.convergence_studies.filter((study) => study.analysis_case_id !== id);
      }),

    addResult: (result) =>
      edit((state) => {
        state.ir.results.push(result);
      }, 'artifact'),

    removeResult: (id) =>
      edit((state) => {
        state.ir.results = state.ir.results.filter((result) => result.id !== id);
      }, 'artifact'),

    // --- Mesh actions ---
    updateGlobalMeshControls: (updates) =>
      edit((state) => {
        Object.assign(state.ir.mesh_controls.global, updates);
      }),

    addLocalMeshControl: (control) =>
      edit((state) => {
        state.ir.mesh_controls.local.push(control);
      }),

    updateLocalMeshControl: (id, updates) =>
      edit((state) => {
        const control = state.ir.mesh_controls.local.find((item) => item.id === id);
        if (!control) return;
        Object.assign(control, updates);
      }),

    removeLocalMeshControl: (id) =>
      edit((state) => {
        state.ir.mesh_controls.local = state.ir.mesh_controls.local.filter((item) => item.id !== id);
      }),

    updateMeshQualityTargets: (updates) =>
      edit((state) => {
        Object.assign(state.ir.mesh_controls.quality_targets, updates);
      }),

    // --- Validation ---
    runValidation: (target, analysisCaseId) =>
      edit((state) => {
        state.ir.validation = runValidation(state.ir, target, analysisCaseId);
      }, 'derived'),

  } satisfies Partial<AppState>;
}
