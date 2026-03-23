import type {
  ProjectIR,
  ProjectMeta,
  Geometry,
  MeshControls,
  ValidationState,
  UIState,
  UnitSystem,
  TrackedValue,
  MaterialParameterKey,
} from './types';
import { generateId } from './id-generator';
import { getUnitPreset } from '../units/presets';

export const SCHEMA_NAME = 'fem-modeler-ir';
export const SCHEMA_VERSION = '0.1.0';
export const APP_VERSION = '0.1.0';

function now(): string {
  return new Date().toISOString();
}

export function createDefaultMeta(): ProjectMeta {
  return {
    schema_name: SCHEMA_NAME,
    schema_version: SCHEMA_VERSION,
    app_version: APP_VERSION,
    project_id: generateId('project'),
    project_name: 'Untitled Project',
    description: '',
    author: '',
    organization: '',
    created_at: now(),
    updated_at: now(),
    tags: [],
    status: 'draft',
    default_solver_target: 'OpenSeesPy',
    domain_type: 'frame',
  };
}

export function createDefaultUnits(): UnitSystem {
  return getUnitPreset('SI');
}

export function createDefaultGeometry(): Geometry {
  return {
    model_type: 'frame_graph',
    source: 'native',
    bodies: [],
    faces: [],
    edges: [],
    vertices: [],
    reference_frames: [],
    geometry_parameters: [],
  };
}

export function createDefaultMeshControls(): MeshControls {
  return {
    global: {
      algorithm_preference: 'auto',
      global_size: null,
      growth_rate: 1.2,
      element_order: 1,
      recombine_preference: 'none',
      curvature_based_refinement: false,
    },
    local: [],
    quality_targets: {
      min_jacobian: 0.3,
      max_aspect_ratio: 10.0,
      min_skewness: 0.1,
      preferred_quality_level: 'balanced',
    },
  };
}

export function createDefaultValidation(): ValidationState {
  return {
    last_run_at: '',
    summary: { error_count: 0, warning_count: 0, info_count: 0 },
    items: [],
  };
}

export function createDefaultUIState(): UIState {
  return {
    active_panel: 'geometry',
    camera_state: {
      position: [10, 10, 10],
      target: [0, 0, 0],
      up: [0, 1, 0],
      zoom: 1,
      orthographic: false,
    },
    visibility_map: {},
    isolate_targets: [],
    selection_state: [],
    expanded_tree_nodes: [],
    color_mode: 'default',
    clipping_planes: [],
    last_opened_tabs: [],
  };
}

export function createTrackedValue<T>(
  value: T,
  status: TrackedValue<T>['status'] = 'missing',
): TrackedValue<T> {
  return { value, status };
}

export function createEmptyParameterSet(): Record<
  MaterialParameterKey,
  TrackedValue<number | null>
> {
  return {
    density: createTrackedValue(null),
    young_modulus: createTrackedValue(null),
    poisson_ratio: createTrackedValue(null),
    thermal_conductivity: createTrackedValue(null),
    specific_heat: createTrackedValue(null),
    dynamic_viscosity: createTrackedValue(null),
    kinematic_viscosity: createTrackedValue(null),
  };
}

export function createDefaultProject(): ProjectIR {
  return {
    meta: createDefaultMeta(),
    units: createDefaultUnits(),
    geometry: createDefaultGeometry(),
    named_selections: [],
    materials: [],
    material_assignments: [],
    sections: [],
    section_assignments: [],
    mesh_controls: createDefaultMeshControls(),
    boundary_conditions: [],
    loads: [],
    initial_conditions: [],
    analysis_cases: [],
    solver_targets: [
      {
        target_name: 'OpenSeesPy',
        enabled: true,
        export_profile: 'permissive',
        solver_options: {},
        path_preferences: {},
        packaging: 'zip_bundle',
      },
      {
        target_name: 'DOLFINx',
        enabled: false,
        export_profile: 'permissive',
        solver_options: {},
        path_preferences: {},
        packaging: 'zip_bundle',
      },
      {
        target_name: 'OpenFOAM',
        enabled: false,
        export_profile: 'template_based',
        solver_options: {},
        path_preferences: {},
        packaging: 'zip_bundle',
      },
    ],
    validation: createDefaultValidation(),
    ui_state: createDefaultUIState(),
    ai_annotations: [],
    audit_trail: [],
  };
}
