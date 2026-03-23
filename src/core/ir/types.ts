/**
 * FEM/CAE共通中間表現(IR) TypeScript型定義
 * 指示書 FEM_WebApp_JSON_IR_Spec.md に完全準拠
 *
 * このIRがアプリ全体の正本データであり、
 * OpenSeesPy / DOLFINx / OpenFOAM の出力はすべてこのIRから生成される。
 */

// ---------------------------------------------------------------------------
// 共通パターン
// ---------------------------------------------------------------------------

export type ValueStatus =
  | 'confirmed'
  | 'inferred'
  | 'imported'
  | 'library'
  | 'missing'
  | 'needs_review';

export interface TrackedValue<T> {
  value: T;
  status: ValueStatus;
  source?: string;
}

// ---------------------------------------------------------------------------
// トップレベル: ProjectIR
// ---------------------------------------------------------------------------

export interface ProjectIR {
  meta: ProjectMeta;
  units: UnitSystem;
  geometry: Geometry;
  named_selections: NamedSelection[];
  materials: Material[];
  material_assignments: MaterialAssignment[];
  sections: Section[];
  section_assignments: SectionAssignment[];
  mesh_controls: MeshControls;
  boundary_conditions: BoundaryCondition[];
  loads: Load[];
  initial_conditions: InitialCondition[];
  analysis_cases: AnalysisCase[];
  solver_targets: SolverTarget[];
  validation: ValidationState;
  ui_state: UIState;
  ai_annotations: AIAnnotation[];
  audit_trail: AuditEntry[];
}

// ---------------------------------------------------------------------------
// meta (Section 5)
// ---------------------------------------------------------------------------

export type DomainType =
  | 'frame'
  | 'truss'
  | 'solid'
  | 'thermal'
  | 'fluid'
  | 'coupled';

export type ProjectStatus = 'draft' | 'review' | 'approved' | 'archived';

export interface ProjectMeta {
  schema_name: string;
  schema_version: string;
  app_version: string;
  project_id: string;
  project_name: string;
  description: string;
  author: string;
  organization: string;
  created_at: string;
  updated_at: string;
  tags: string[];
  status: ProjectStatus;
  default_solver_target: string;
  domain_type: DomainType;
}

// ---------------------------------------------------------------------------
// units (Section 6)
// ---------------------------------------------------------------------------

export type UnitSystemName = 'SI' | 'mm-N-s' | 'mm-t-s' | 'custom';

export interface UnitSystem {
  system_name: UnitSystemName;
  base_length: string;
  base_mass: string;
  base_time: string;
  base_temperature: string;
  base_force: string;
  angle_unit: string;
  display_precision: number;
  preferred_stress_unit: string;
  preferred_pressure_unit: string;
  preferred_energy_unit: string;
}

// ---------------------------------------------------------------------------
// geometry (Section 7)
// ---------------------------------------------------------------------------

export type GeometryModelType =
  | 'cad_brep'
  | 'mesh_only'
  | 'frame_graph'
  | 'hybrid';

export type GeometrySource =
  | 'native'
  | 'imported_step'
  | 'imported_stl'
  | 'imported_obj'
  | 'imported_msh'
  | 'generated_by_ai';

export type BodyCategory =
  | 'solid'
  | 'shell'
  | 'beam_region'
  | 'fluid_region'
  | 'void';

export interface Transform {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

export interface GeometryBody {
  id: string;
  name: string;
  category: BodyCategory;
  visible: boolean;
  locked: boolean;
  color: string;
  transform: Transform;
  topology_ref: string;
  metadata: Record<string, unknown>;
}

export interface GeometryFace {
  id: string;
  name: string;
  body_id: string;
  normal?: [number, number, number];
  area?: number;
  triangle_indices: number[];
}

export interface GeometryEdge {
  id: string;
  name: string;
  body_id: string;
  vertex_ids: [string, string];
  length?: number;
}

export interface GeometryVertex {
  id: string;
  name: string;
  body_id: string;
  position: [number, number, number];
}

export type ReferenceFrameType = 'cartesian' | 'cylindrical' | 'local_beam';

export interface ReferenceFrame {
  id: string;
  name: string;
  origin: [number, number, number];
  axis_x: [number, number, number];
  axis_y: [number, number, number];
  axis_z: [number, number, number];
  type: ReferenceFrameType;
  attached_to?: string;
}

export interface GeometryParameter {
  id: string;
  name: string;
  value: number;
  description: string;
}

export interface Geometry {
  model_type: GeometryModelType;
  source: GeometrySource;
  bodies: GeometryBody[];
  faces: GeometryFace[];
  edges: GeometryEdge[];
  vertices: GeometryVertex[];
  reference_frames: ReferenceFrame[];
  geometry_parameters: GeometryParameter[];
}

// ---------------------------------------------------------------------------
// named_selections (Section 8)
// ---------------------------------------------------------------------------

export type EntityType =
  | 'vertex'
  | 'edge'
  | 'face'
  | 'body'
  | 'node'
  | 'element'
  | 'cell'
  | 'patch';

export type NamedSelectionCreatedBy = 'user' | 'import' | 'ai';

export type NamedSelectionStatus = 'active' | 'stale' | 'unresolved';

export type NamedSelectionUsage =
  | 'material_assignment'
  | 'section_assignment'
  | 'boundary_condition'
  | 'load'
  | 'initial_condition'
  | 'mesh_control'
  | 'export_tag';

export interface NamedSelection {
  id: string;
  name: string;
  display_name?: string;
  target_dimension: 0 | 1 | 2 | 3;
  entity_type: EntityType;
  member_refs: string[];
  color: string;
  description: string;
  created_by: NamedSelectionCreatedBy;
  status: NamedSelectionStatus;
  usages: NamedSelectionUsage[];
}

// ---------------------------------------------------------------------------
// materials (Section 9)
// ---------------------------------------------------------------------------

export type MaterialClass =
  | 'elastic'
  | 'thermo_elastic'
  | 'fluid_newtonian'
  | 'user_defined';

export type PhysicalModel =
  | 'isotropic_linear'
  | 'orthotropic_linear'
  | 'incompressible_newtonian'
  | 'constant_property';

export type MaterialParameterKey =
  | 'density'
  | 'young_modulus'
  | 'poisson_ratio'
  | 'thermal_conductivity'
  | 'specific_heat'
  | 'dynamic_viscosity'
  | 'kinematic_viscosity';

export interface Material {
  id: string;
  name: string;
  class: MaterialClass;
  physical_model: PhysicalModel;
  parameter_set: Record<MaterialParameterKey, TrackedValue<number | null>>;
  source: string;
  notes: string;
}

export interface MaterialAssignment {
  id: string;
  material_id: string;
  target_named_selection_id: string;
  override_allowed: boolean;
}

// ---------------------------------------------------------------------------
// sections (Section 10)
// ---------------------------------------------------------------------------

export type SectionType =
  | 'beam_rect'
  | 'beam_circle'
  | 'beam_h'
  | 'shell_thickness'
  | 'generic_frame_section';

export interface Section {
  id: string;
  name: string;
  section_type: SectionType;
  dimensions: Record<string, number>;
  material_id: string;
  orientation_ref?: string;
  area: number | null;
  inertia_y: number | null;
  inertia_z: number | null;
  torsion_constant: number | null;
  thickness: number | null;
  metadata: Record<string, unknown>;
}

export interface SectionAssignment {
  id: string;
  section_id: string;
  target_named_selection_id: string;
}

// ---------------------------------------------------------------------------
// mesh_controls (Section 11)
// ---------------------------------------------------------------------------

export type MeshAlgorithmPreference =
  | 'auto'
  | 'delaunay'
  | 'frontal'
  | 'structured';

export type MeshElementOrder = 1 | 2;

export type MeshRecombinePreference = 'none' | 'all' | 'structured_only';

export type MeshLocalControlType =
  | 'local_size'
  | 'edge_division'
  | 'face_refinement'
  | 'boundary_layer'
  | 'structured_hint';

export type MeshQualityLevel = 'preview' | 'balanced' | 'high_quality';

export interface MeshGlobalControls {
  algorithm_preference: MeshAlgorithmPreference;
  global_size: number | null;
  growth_rate: number;
  element_order: MeshElementOrder;
  recombine_preference: MeshRecombinePreference;
  curvature_based_refinement: boolean;
}

export interface MeshLocalControl {
  id: string;
  target_named_selection_id: string;
  control_type: MeshLocalControlType;
  size: number | null;
  layers: number | null;
  bias: number | null;
  transfinite_hint: boolean;
  boundary_layer_hint: boolean;
  priority: number;
}

export interface MeshQualityTargets {
  min_jacobian: number;
  max_aspect_ratio: number;
  min_skewness: number;
  preferred_quality_level: MeshQualityLevel;
}

export interface MeshControls {
  global: MeshGlobalControls;
  local: MeshLocalControl[];
  quality_targets: MeshQualityTargets;
}

// ---------------------------------------------------------------------------
// boundary_conditions (Section 12)
// ---------------------------------------------------------------------------

export type PhysicsDomain = 'structural' | 'thermal' | 'fluid';

export type BoundaryConditionType =
  | 'fixed'
  | 'prescribed_displacement'
  | 'symmetry'
  | 'temperature'
  | 'heat_flux'
  | 'convection'
  | 'insulation'
  | 'velocity_inlet'
  | 'pressure_outlet'
  | 'wall'
  | 'slip'
  | 'no_slip';

export type TemporalProfile =
  | 'constant'
  | 'ramp'
  | 'table'
  | 'expression'
  | 'time_series_ref';

export type DofState = 'fixed' | 'free' | 'prescribed';

export interface DofMap {
  ux: DofState;
  uy: DofState;
  uz: DofState;
  rx: DofState;
  ry: DofState;
  rz: DofState;
}

export interface BCValues {
  scalar?: number;
  vector?: [number, number, number];
  dof_map?: DofMap;
  function_ref?: string;
}

export interface BoundaryCondition {
  id: string;
  name: string;
  physics_domain: PhysicsDomain;
  bc_type: BoundaryConditionType;
  target_named_selection_id: string;
  coordinate_system: string;
  values: BCValues;
  temporal_profile: TemporalProfile;
  status: ValueStatus;
  notes: string;
}

// ---------------------------------------------------------------------------
// loads (Section 13)
// ---------------------------------------------------------------------------

export type LoadType =
  | 'nodal_force'
  | 'surface_traction'
  | 'body_force'
  | 'gravity'
  | 'line_load'
  | 'pressure'
  | 'heat_source'
  | 'volumetric_heat'
  | 'mass_flow_rate';

export type LoadApplicationMode =
  | 'total'
  | 'per_area'
  | 'per_length'
  | 'per_volume';

export type LoadDistribution = 'uniform' | 'linear' | 'table' | 'field_ref';

export interface Load {
  id: string;
  name: string;
  physics_domain: PhysicsDomain;
  load_type: LoadType;
  target_named_selection_id: string;
  application_mode: LoadApplicationMode;
  direction: [number, number, number];
  magnitude: number;
  distribution: LoadDistribution;
  temporal_profile: TemporalProfile;
  load_case: string;
  coordinate_system: string;
  status: ValueStatus;
}

// ---------------------------------------------------------------------------
// initial_conditions (Section 14)
// ---------------------------------------------------------------------------

export type InitialConditionType =
  | 'initial_temperature'
  | 'initial_velocity'
  | 'initial_pressure'
  | 'initial_displacement';

export interface InitialCondition {
  id: string;
  name: string;
  physics_domain: PhysicsDomain;
  ic_type: InitialConditionType;
  target_named_selection_id: string;
  values: BCValues;
  status: ValueStatus;
}

// ---------------------------------------------------------------------------
// analysis_cases (Section 15)
// ---------------------------------------------------------------------------

export type AnalysisType =
  | 'static_linear'
  | 'static_nonlinear'
  | 'modal'
  | 'transient_structural'
  | 'steady_thermal'
  | 'transient_thermal'
  | 'incompressible_flow_steady'
  | 'incompressible_flow_transient';

export type SolverProfileHint =
  | 'openseespy_frame_basic'
  | 'dolfinx_linear_elasticity'
  | 'dolfinx_poisson'
  | 'dolfinx_steady_heat'
  | 'openfoam_simpleFoam'
  | 'openfoam_pisoFoam'
  | 'openfoam_laplacianFoam';

export type ResultRequest =
  | 'displacement'
  | 'stress'
  | 'temperature'
  | 'velocity'
  | 'pressure'
  | 'reaction_force';

export interface AnalysisCase {
  id: string;
  name: string;
  active: boolean;
  domain_type: DomainType;
  analysis_type: AnalysisType;
  nonlinear: boolean;
  transient: boolean;
  participating_material_ids: string[];
  participating_section_ids: string[];
  participating_bc_ids: string[];
  participating_load_ids: string[];
  participating_ic_ids: string[];
  mesh_policy_ref: string;
  solver_profile_hint: SolverProfileHint;
  result_requests: ResultRequest[];
}

// ---------------------------------------------------------------------------
// solver_targets (Section 16)
// ---------------------------------------------------------------------------

export type SolverTargetName = 'OpenSeesPy' | 'DOLFINx' | 'OpenFOAM';

export type ExportProfile = 'strict' | 'permissive' | 'template_based';

export type PackagingType =
  | 'single_file'
  | 'multi_file'
  | 'zip_bundle'
  | 'folder_tree';

export interface SolverTarget {
  target_name: SolverTargetName;
  enabled: boolean;
  export_profile: ExportProfile;
  solver_options: Record<string, unknown>;
  path_preferences: Record<string, string>;
  packaging: PackagingType;
}

// ---------------------------------------------------------------------------
// validation (Section 17)
// ---------------------------------------------------------------------------

export type ValidationSeverity = 'error' | 'warning' | 'info';

export type ValidationItemStatus = 'open' | 'dismissed' | 'resolved';

export interface ValidationItem {
  id: string;
  severity: ValidationSeverity;
  code: string;
  title: string;
  message: string;
  target_ref: string;
  suggested_fix: string;
  dismissible: boolean;
  status: ValidationItemStatus;
}

export interface ValidationSummary {
  error_count: number;
  warning_count: number;
  info_count: number;
}

export interface ValidationState {
  last_run_at: string;
  summary: ValidationSummary;
  items: ValidationItem[];
}

// ---------------------------------------------------------------------------
// ui_state (Section 18)
// ---------------------------------------------------------------------------

export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  zoom: number;
  orthographic: boolean;
}

export interface ClippingPlane {
  normal: [number, number, number];
  constant: number;
  enabled: boolean;
}

export interface UIState {
  active_panel: string;
  camera_state: CameraState;
  visibility_map: Record<string, boolean>;
  isolate_targets: string[];
  selection_state: string[];
  expanded_tree_nodes: string[];
  color_mode: 'default' | 'by_material' | 'by_selection' | 'by_condition';
  clipping_planes: ClippingPlane[];
  last_opened_tabs: string[];
}

// ---------------------------------------------------------------------------
// ai_annotations (Section 19) — 将来のAI支援用、当面未使用
// ---------------------------------------------------------------------------

export type AIProposalType =
  | 'naming'
  | 'material_suggestion'
  | 'mesh_hint'
  | 'missing_bc_warning'
  | 'export_gap_notice';

export type AIAnnotationStatus =
  | 'proposed'
  | 'accepted'
  | 'rejected'
  | 'expired';

export interface AIAnnotation {
  id: string;
  source_prompt_summary: string;
  target_ref: string;
  proposal_type: AIProposalType;
  rationale: string;
  confidence: number;
  status: AIAnnotationStatus;
  applied_changes: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// audit_trail (Section 20)
// ---------------------------------------------------------------------------

export type AuditActor = 'user' | 'ai' | 'import' | 'migration';

export type AuditActionType =
  | 'create'
  | 'update'
  | 'delete'
  | 'assign'
  | 'import'
  | 'export'
  | 'validate'
  | 'unit_conversion'
  | 'ai_proposal_accepted'
  | 'ai_proposal_rejected';

export interface AuditEntry {
  id: string;
  timestamp: string;
  actor: AuditActor;
  action_type: AuditActionType;
  target_ref: string;
  before_summary: string;
  after_summary: string;
  note: string;
}
