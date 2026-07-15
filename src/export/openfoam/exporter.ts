import type {
  AnalysisCase,
  BoundaryCondition,
  GeometryFace,
  GeometryBody,
  Material,
  NamedSelection,
  ProjectIR,
  SolverTarget,
} from '@/core/ir/types';
import { applyTransformToPoint } from '@/geometry/transforms';
import { saveAs } from 'file-saver';
import JSZip from 'jszip';
import { sanitizeArtifactName } from '@/export/shared/artifact-sanitization';
import { scopeProjectForAnalysisCaseValidation } from '@/export/compiler';

export interface OpenFOAMExportResult {
  success: boolean;
  files: Record<string, string>;
  manifest: string;
  errors: string[];
  warnings: string[];
}

type SimulationMode = '2D' | '3D';
type FrontBackType = 'empty' | 'wall' | 'patch';
type PressureBasis = 'dynamic' | 'kinematic';

interface PatchInfo {
  name: string;
  type: 'patch' | 'wall' | 'empty';
  bc?: BoundaryCondition;
  selection?: NamedSelection;
  face?: GeometryFace;
}

interface ResolvedPatches {
  inlet: PatchInfo;
  outlet: PatchInfo;
  wallTop: PatchInfo;
  wallBottom: PatchInfo;
  frontAndBack: PatchInfo;
  unique: boolean;
}

interface MaterialProperties {
  material?: Material;
  assignmentId?: string;
  assignmentSelectionId?: string;
  density?: number;
  kinematicViscosity?: number;
}

type ChannelBoundaryRole = 'inlet' | 'outlet' | 'wall_top' | 'wall_bottom';

interface ResolvedBoundarySelection {
  role: ChannelBoundaryRole;
  selection: NamedSelection;
  face: GeometryFace;
}

interface ResolvedPressure {
  inputValue: number;
  basis: PressureBasis;
  kinematicValue: number;
}

const MAX_CELLS_PER_DIRECTION = 1_000_000;
const MAX_TOTAL_CELLS = 50_000_000;
const DEFAULT_MESH_SETTINGS = {
  algorithm_preference: 'auto',
  growth_rate: 1.2,
  element_order: 1,
  recombine_preference: 'none',
  curvature_based_refinement: false,
  min_jacobian: 0.3,
  max_aspect_ratio: 10,
  min_skewness: 0.1,
  preferred_quality_level: 'balanced',
} as const;

const VALIDATED_BUT_NOT_CONSUMED_MESH_FIELDS = [
  'mesh_controls.global.algorithm_preference',
  'mesh_controls.global.growth_rate',
  'mesh_controls.global.element_order',
  'mesh_controls.global.recombine_preference',
  'mesh_controls.global.curvature_based_refinement',
  'mesh_controls.quality_targets.min_jacobian',
  'mesh_controls.quality_targets.max_aspect_ratio',
  'mesh_controls.quality_targets.min_skewness',
  'mesh_controls.quality_targets.preferred_quality_level',
] as const;

function foamHeader(className: string, object: string, location: string = ''): string {
  return `FoamFile
{
    version     2.0;
    format      ascii;
    class       ${className};
    ${location ? `location    "${location}";\n    ` : ''}object      ${object};
}`;
}

function foamNumber(value: number): string {
  if (Object.is(value, -0) || value === 0) return '0';
  return String(Number(value.toPrecision(15)));
}

function makeManifest(data: Record<string, unknown>): string {
  return JSON.stringify(data, null, 2);
}

function earlyFailure(
  ir: ProjectIR,
  errors: string[],
  warnings: string[],
): OpenFOAMExportResult {
  return {
    success: false,
    files: {},
    manifest: makeManifest({
      export_target: 'OpenFOAM',
      export_time: new Date().toISOString(),
      source_project: ir.meta.project_name,
      schema_version: ir.meta.schema_version,
      solver: 'simpleFoam',
      warnings,
      errors,
    }),
    errors,
    warnings,
  };
}

function normalizeMode(value: unknown): SimulationMode | undefined {
  if (value === 2) return '2D';
  if (value === 3) return '3D';
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (normalized === '2' || normalized === '2d' || normalized === 'twodimensional') return '2D';
  if (normalized === '3' || normalized === '3d' || normalized === 'threedimensional') return '3D';
  return undefined;
}

function resolveSimulationMode(
  body: GeometryBody,
  solverOptions: Record<string, unknown>,
  errors: string[],
): { mode: SimulationMode; frontBackType: FrontBackType } {
  const signals: Array<{ source: string; mode: SimulationMode }> = [];
  const explicitKeys = ['dimensionality', 'dimension', 'mesh_dimension', 'simulation_mode'] as const;

  for (const [scope, values] of [
    ['OpenFOAM solver_options', solverOptions],
    ['channel metadata', body.metadata],
  ] as const) {
    for (const key of explicitKeys) {
      const value = values[key];
      if (value === undefined) continue;
      const mode = normalizeMode(value);
      if (mode) signals.push({ source: `${scope}.${key}`, mode });
      else errors.push(`${scope}.${key} must be either 2D or 3D.`);
    }

    // `mode` is accepted for compatibility only when it clearly denotes a dimension.
    if (values.mode !== undefined) {
      const mode = normalizeMode(values.mode);
      if (mode) signals.push({ source: `${scope}.mode`, mode });
    }

    for (const key of ['two_dimensional', 'twoDimensional', 'is_2d', 'is2D'] as const) {
      const value = values[key];
      if (value === undefined) continue;
      if (typeof value !== 'boolean') {
        errors.push(`${scope}.${key} must be a boolean.`);
      } else {
        signals.push({ source: `${scope}.${key}`, mode: value ? '2D' : '3D' });
      }
    }
  }

  const rawFrontBackType = solverOptions.front_back_type ?? solverOptions.frontBackType;
  let requestedFrontBackType: FrontBackType | undefined;
  if (rawFrontBackType !== undefined) {
    if (rawFrontBackType === 'empty' || rawFrontBackType === 'wall' || rawFrontBackType === 'patch') {
      requestedFrontBackType = rawFrontBackType;
      signals.push({
        source: 'OpenFOAM solver_options.front_back_type',
        mode: rawFrontBackType === 'empty' ? '2D' : '3D',
      });
    } else {
      errors.push('OpenFOAM solver_options.front_back_type must be empty, wall, or patch.');
    }
  }

  const distinctModes = new Set(signals.map((signal) => signal.mode));
  if (distinctModes.size > 1) {
    errors.push(`Conflicting OpenFOAM dimensionality settings: ${signals
      .map((signal) => `${signal.source}=${signal.mode}`)
      .join(', ')}.`);
  }

  const mode = signals[0]?.mode ?? '3D';
  if (signals.length === 0) {
    errors.push('OpenFOAM dimensionality must be explicit in solver_options or channel metadata; no 2D/3D default was applied.');
  }

  if (mode === '2D') return { mode, frontBackType: 'empty' };
  return { mode, frontBackType: requestedFrontBackType ?? 'wall' };
}

function resolveConvertToMeters(
  ir: ProjectIR,
  errors: string[],
  warnings: string[],
): number | undefined {
  const valueBasis = (ir.units as unknown as { value_basis?: unknown }).value_basis;
  if (valueBasis === 'SI') return 1;

  if (valueBasis !== undefined) {
    errors.push(`Unsupported IR unit value_basis "${String(valueBasis)}" for OpenFOAM export.`);
    return undefined;
  }

  const normalizedLength = ir.units.base_length.trim().toLowerCase();
  const factors: Record<string, number> = {
    m: 1,
    meter: 1,
    metre: 1,
    mm: 1e-3,
    millimeter: 1e-3,
    millimetre: 1e-3,
    cm: 1e-2,
    centimeter: 1e-2,
    centimetre: 1e-2,
    um: 1e-6,
    'µm': 1e-6,
    'μm': 1e-6,
    in: 0.0254,
    inch: 0.0254,
    ft: 0.3048,
    foot: 0.3048,
  };
  const factor = factors[normalizedLength];
  if (factor === undefined) {
    errors.push(`Unsupported legacy base_length "${ir.units.base_length}" for blockMesh convertToMeters.`);
    return undefined;
  }

  warnings.push(
    `Legacy IR without units.value_basis detected; blockMesh coordinates are interpreted as ${ir.units.base_length}.`,
  );
  return factor;
}

function validateSolverSelection(
  ir: ProjectIR,
  target: SolverTarget | undefined,
  errors: string[],
): AnalysisCase | undefined {
  if (!target) {
    errors.push('OpenFOAM solver target is missing from the project.');
    return undefined;
  }

  const solverOption = target.solver_options.application
    ?? target.solver_options.solver
    ?? target.solver_options.solver_profile_hint;
  if (solverOption !== undefined) {
    if (typeof solverOption !== 'string') {
      errors.push('The OpenFOAM solver option must be a string.');
    } else if (solverOption !== 'simpleFoam' && solverOption !== 'openfoam_simpleFoam') {
      errors.push(`Unsupported OpenFOAM solver "${solverOption}"; this exporter supports simpleFoam only.`);
    }
  }

  const candidates = ir.analysis_cases.filter(
    (analysisCase) => analysisCase.active
      && (analysisCase.domain_type === 'fluid' || analysisCase.solver_profile_hint.startsWith('openfoam_')),
  );
  if (candidates.length > 1) {
    errors.push('Multiple active fluid/OpenFOAM analysis cases are ambiguous; activate exactly one case.');
    return undefined;
  }

  const analysisCase = candidates[0];
  if (!analysisCase) {
    errors.push('OpenFOAM strict export requires exactly one active fluid simpleFoam analysis case.');
    return undefined;
  }

  if (analysisCase.solver_profile_hint !== 'openfoam_simpleFoam') {
    errors.push(
      `Analysis case "${analysisCase.name}" requests ${analysisCase.solver_profile_hint}, but only openfoam_simpleFoam is supported.`,
    );
  }
  if (analysisCase.analysis_type !== 'incompressible_flow_steady'
      || analysisCase.transient
      || analysisCase.nonlinear) {
    errors.push(
      `Analysis case "${analysisCase.name}" is not a supported steady incompressible simpleFoam case.`,
    );
  }
  for (const request of analysisCase.result_requests) {
    if (request !== 'velocity' && request !== 'pressure') {
      errors.push(`Analysis case "${analysisCase.name}" requests unsupported OpenFOAM result "${request}".`);
    }
  }
  const selectedIds = <T extends { id: string }>(items: T[], ids: string[], label: string): T[] => {
    if (ids.length === 0) return items;
    const known = new Set(items.map((item) => item.id));
    for (const id of ids) if (!known.has(id)) errors.push(`Analysis case references missing ${label} "${id}".`);
    const requested = new Set(ids);
    return items.filter((item) => requested.has(item.id));
  };
  for (const load of selectedIds(ir.loads, analysisCase.participating_load_ids, 'load')) {
    errors.push(`OpenFOAM simpleFoam channel export does not consume load "${load.name}" (${load.load_type}).`);
  }
  for (const condition of selectedIds(ir.initial_conditions, analysisCase.participating_ic_ids, 'initial condition')) {
    errors.push(`OpenFOAM simpleFoam channel export does not consume initial condition "${condition.name}" (${condition.ic_type}).`);
  }
  if (ir.sections.length > 0 || ir.section_assignments.length > 0) {
    errors.push(
      `OpenFOAM simpleFoam channel export does not consume sections or section assignments (sections=${ir.sections.length}, assignments=${ir.section_assignments.length}).`,
    );
  }
  if (analysisCase.mesh_policy_ref) {
    errors.push(`OpenFOAM mesh policy "${analysisCase.mesh_policy_ref}" is not implemented.`);
  }
  return analysisCase;
}

function materialSelectionTargetsBody(
  selection: NamedSelection | undefined,
  body: GeometryBody,
): boolean {
  return selection !== undefined
    && selection.target_dimension === 3
    && (selection.entity_type === 'body' || selection.entity_type === 'cell')
    && selection.member_refs.includes(body.id);
}

function slugPatchName(rawName: string, fallback: string, warnings: string[]): string {
  const ascii = rawName.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  let slug = ascii
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!slug) slug = fallback;
  if (!/^[A-Za-z_]/.test(slug)) slug = `patch_${slug}`;
  if (slug !== rawName) {
    warnings.push(`OpenFOAM patch name "${rawName}" was sanitized to "${slug}".`);
  }
  return slug;
}

function channelFaceByRole(
  ir: ProjectIR,
  body: GeometryBody,
  role: ChannelBoundaryRole,
  errors: string[],
): GeometryFace | undefined {
  const matches = ir.geometry.faces.filter(
    (face) => face.body_id === body.id && face.name === role,
  );
  if (matches.length !== 1) {
    errors.push(
      `Channel topology must contain exactly one "${role}" face for body "${body.name}"; found ${matches.length}.`,
    );
    return undefined;
  }
  return matches[0];
}

function resolveBoundarySelection(
  ir: ProjectIR,
  body: GeometryBody,
  bc: BoundaryCondition,
  allowedRoles: readonly ChannelBoundaryRole[],
  channelFaces: Map<ChannelBoundaryRole, GeometryFace>,
  errors: string[],
): ResolvedBoundarySelection | undefined {
  const selection = ir.named_selections.find((candidate) => candidate.id === bc.target_named_selection_id);
  if (!selection) {
    errors.push(`Boundary condition "${bc.name}" references a missing named selection.`);
    return undefined;
  }
  if (selection.status !== 'active') {
    errors.push(`Named selection "${selection.name}" for boundary condition "${bc.name}" is not active.`);
  }
  if (selection.target_dimension !== 2 || selection.entity_type !== 'face') {
    errors.push(
      `Named selection "${selection.name}" for boundary condition "${bc.name}" must be a 2D face selection, not ${selection.target_dimension}D ${selection.entity_type}.`,
    );
  }
  if (selection.member_refs.length !== 1) {
    errors.push(
      `Named selection "${selection.name}" for boundary condition "${bc.name}" must contain exactly one channel face; found ${selection.member_refs.length}.`,
    );
    return undefined;
  }

  const memberRef = selection.member_refs[0];
  if (memberRef === body.id) {
    errors.push(
      `Named selection "${selection.name}" for boundary condition "${bc.name}" references the channel body; a topology face ID is required.`,
    );
    return undefined;
  }
  const face = ir.geometry.faces.find((candidate) => candidate.id === memberRef);
  if (!face) {
    errors.push(
      `Named selection "${selection.name}" for boundary condition "${bc.name}" references missing face "${memberRef}".`,
    );
    return undefined;
  }
  if (face.body_id !== body.id) {
    errors.push(
      `Named selection "${selection.name}" for boundary condition "${bc.name}" targets a face outside channel body "${body.name}".`,
    );
    return undefined;
  }

  const role = allowedRoles.find((candidate) => channelFaces.get(candidate)?.id === face.id);
  if (!role) {
    errors.push(
      `Boundary condition "${bc.name}" targets channel face "${face.name}", but its required topology role is ${allowedRoles.join(' or ')}.`,
    );
    return undefined;
  }
  if (face.name !== role) {
    errors.push(
      `Channel topology face "${face.id}" has role mismatch: expected "${role}" but found "${face.name}".`,
    );
    return undefined;
  }
  return { role, selection, face };
}

function validateWallBoundary(bc: BoundaryCondition, errors: string[]): void {
  if (bc.status !== 'confirmed') {
    errors.push(`Wall boundary condition "${bc.name}" must have confirmed status; found ${bc.status}.`);
  }
  if (bc.temporal_profile !== 'constant') {
    errors.push(`Wall boundary condition "${bc.name}" must use a constant temporal profile.`);
  }
  if (bc.coordinate_system !== 'global') {
    errors.push(`Wall boundary condition "${bc.name}" must use the global coordinate system.`);
  }
}

function resolvePatches(
  ir: ProjectIR,
  body: GeometryBody,
  analysisCase: AnalysisCase | undefined,
  frontBackType: FrontBackType,
  solverOptions: Record<string, unknown>,
  errors: string[],
  warnings: string[],
): ResolvedPatches {
  const channelFaces = new Map<ChannelBoundaryRole, GeometryFace>();
  for (const role of ['inlet', 'outlet', 'wall_top', 'wall_bottom'] as const) {
    const face = channelFaceByRole(ir, body, role, errors);
    if (face) channelFaces.set(role, face);
  }

  let scopedBCs = ir.boundary_conditions;
  if (analysisCase && analysisCase.participating_bc_ids.length > 0) {
    const requestedIds = new Set(analysisCase.participating_bc_ids);
    for (const id of requestedIds) {
      if (!ir.boundary_conditions.some((bc) => bc.id === id)) {
        errors.push(`Analysis case references missing boundary condition "${id}".`);
      }
    }
    scopedBCs = scopedBCs.filter((bc) => requestedIds.has(bc.id));
  }
  for (const bc of scopedBCs) {
    if (bc.physics_domain !== 'fluid') {
      errors.push(
        `Boundary condition "${bc.name}" belongs to ${bc.physics_domain}, but the OpenFOAM channel case accepts fluid conditions only.`,
      );
    }
  }
  const fluidBCs = scopedBCs.filter((bc) => bc.physics_domain === 'fluid');

  const inletBCs = fluidBCs.filter((bc) => bc.bc_type === 'velocity_inlet');
  const outletBCs = fluidBCs.filter((bc) => bc.bc_type === 'pressure_outlet');
  const wallBCs = fluidBCs.filter((bc) => bc.bc_type === 'wall' || bc.bc_type === 'no_slip');
  const supportedIds = new Set([...inletBCs, ...outletBCs, ...wallBCs].map((bc) => bc.id));
  for (const bc of fluidBCs) {
    if (!supportedIds.has(bc.id)) {
      errors.push(`Fluid boundary condition "${bc.name}" (${bc.bc_type}) is not supported by the channel exporter.`);
    }
  }

  if (inletBCs.length !== 1) {
    errors.push(`OpenFOAM channel export requires exactly one velocity inlet; found ${inletBCs.length}.`);
  }
  if (outletBCs.length !== 1) {
    errors.push(`OpenFOAM channel export requires exactly one pressure outlet; found ${outletBCs.length}.`);
  }
  if (wallBCs.length !== 2) {
    errors.push(`OpenFOAM channel export requires exactly two top/bottom wall conditions; found ${wallBCs.length}.`);
  }

  const boundaryRoleBCs = [...inletBCs, ...outletBCs, ...wallBCs];
  const rawSelectionAssignments = new Map<string, string>();
  const rawFaceAssignments = new Map<string, string>();
  for (const bc of boundaryRoleBCs) {
    const previousBC = rawSelectionAssignments.get(bc.target_named_selection_id);
    if (previousBC) {
      errors.push(
        `Named selection "${bc.target_named_selection_id}" is assigned to multiple channel boundary conditions (${previousBC} and ${bc.name}).`,
      );
    } else {
      rawSelectionAssignments.set(bc.target_named_selection_id, bc.name);
    }
    const selection = ir.named_selections.find(
      (candidate) => candidate.id === bc.target_named_selection_id,
    );
    if (selection?.member_refs.length !== 1) continue;
    const face = ir.geometry.faces.find((candidate) => candidate.id === selection.member_refs[0]);
    if (!face || face.body_id !== body.id) continue;
    const previousFaceBC = rawFaceAssignments.get(face.id);
    if (previousFaceBC) {
      errors.push(
        `Channel face "${face.name}" is assigned to multiple boundary conditions (${previousFaceBC} and ${bc.name}).`,
      );
    } else {
      rawFaceAssignments.set(face.id, bc.name);
    }
  }

  const inletBC = inletBCs.length === 1 ? inletBCs[0] : undefined;
  const outletBC = outletBCs.length === 1 ? outletBCs[0] : undefined;
  const inlet = inletBC
    ? resolveBoundarySelection(ir, body, inletBC, ['inlet'], channelFaces, errors)
    : undefined;
  const outlet = outletBC
    ? resolveBoundarySelection(ir, body, outletBC, ['outlet'], channelFaces, errors)
    : undefined;
  const resolvedWalls = wallBCs.map((bc) => {
    validateWallBoundary(bc, errors);
    return {
      bc,
      boundary: resolveBoundarySelection(
        ir,
        body,
        bc,
        ['wall_top', 'wall_bottom'],
        channelFaces,
        errors,
      ),
    };
  });
  const topWalls = resolvedWalls.filter((item) => item.boundary?.role === 'wall_top');
  const bottomWalls = resolvedWalls.filter((item) => item.boundary?.role === 'wall_bottom');
  if (wallBCs.length === 2 && (topWalls.length !== 1 || bottomWalls.length !== 1)) {
    errors.push(
      `OpenFOAM channel walls must map one-to-one to wall_top and wall_bottom; resolved ${topWalls.length} top and ${bottomWalls.length} bottom.`,
    );
  }

  const topWall = topWalls[0];
  const bottomWall = bottomWalls[0];
  const topWallBoundary = topWall?.boundary;
  const bottomWallBoundary = bottomWall?.boundary;

  const rawFrontBackName = solverOptions.front_back_name ?? solverOptions.frontBackName ?? 'frontAndBack';
  if (typeof rawFrontBackName !== 'string') {
    errors.push('OpenFOAM solver_options.front_back_name must be a string.');
  }

  const patches: ResolvedPatches = {
    inlet: {
      name: slugPatchName(inlet?.selection.name ?? 'inlet', 'inlet', warnings),
      type: 'patch',
      bc: inletBC,
      selection: inlet?.selection,
      face: inlet?.face,
    },
    outlet: {
      name: slugPatchName(outlet?.selection.name ?? 'outlet', 'outlet', warnings),
      type: 'patch',
      bc: outletBC,
      selection: outlet?.selection,
      face: outlet?.face,
    },
    wallTop: {
      name: slugPatchName(topWallBoundary?.selection.name ?? 'wall_top', 'wall_top', warnings),
      type: 'wall',
      bc: topWall?.bc,
      selection: topWallBoundary?.selection,
      face: topWallBoundary?.face,
    },
    wallBottom: {
      name: slugPatchName(bottomWallBoundary?.selection.name ?? 'wall_bottom', 'wall_bottom', warnings),
      type: 'wall',
      bc: bottomWall?.bc,
      selection: bottomWallBoundary?.selection,
      face: bottomWallBoundary?.face,
    },
    frontAndBack: {
      name: slugPatchName(
        typeof rawFrontBackName === 'string' ? rawFrontBackName : 'frontAndBack',
        'frontAndBack',
        warnings,
      ),
      type: frontBackType,
    },
    unique: true,
  };

  const seen = new Map<string, string>();
  for (const [role, patch] of Object.entries(patches)) {
    if (role === 'unique' || typeof patch !== 'object') continue;
    const patchInfo = patch as PatchInfo;
    const key = patchInfo.name.toLowerCase();
    const previousRole = seen.get(key);
    if (previousRole) {
      errors.push(
        `Duplicate OpenFOAM patch name "${patchInfo.name}" after sanitization (${previousRole} and ${role}).`,
      );
      patches.unique = false;
    } else {
      seen.set(key, role);
    }
  }

  return patches;
}

function trackedPositiveValue(
  material: Material,
  key: 'density' | 'dynamic_viscosity' | 'kinematic_viscosity',
  errors: string[],
): number | undefined {
  const tracked = material.parameter_set[key];
  if (!tracked || typeof tracked !== 'object') {
    errors.push(`Material "${material.name}" is missing the ${key} parameter record.`);
    return undefined;
  }
  if (tracked.value === null) return undefined;
  if (typeof tracked.value !== 'number' || !Number.isFinite(tracked.value) || tracked.value <= 0) {
    errors.push(`Material "${material.name}" has invalid ${key}; it must be finite and greater than zero.`);
    return undefined;
  }
  if (tracked.status === 'missing' || tracked.status === 'needs_review') {
    errors.push(`Material "${material.name}" ${key} is not confirmed for export (status: ${tracked.status}).`);
    return undefined;
  }
  return tracked.value;
}

function resolveMaterialProperties(
  ir: ProjectIR,
  body: GeometryBody,
  analysisCase: AnalysisCase | undefined,
  errors: string[],
): MaterialProperties {
  const matchingAssignments = ir.material_assignments.filter((assignment) => {
    const selection = ir.named_selections.find(
      (candidate) => candidate.id === assignment.target_named_selection_id,
    );
    return materialSelectionTargetsBody(selection, body);
  });
  for (const assignment of ir.material_assignments) {
    if (!matchingAssignments.includes(assignment)) {
      errors.push(
        `Material assignment "${assignment.id}" is not consumed because it does not resolve to the channel body.`,
      );
    }
  }

  if (matchingAssignments.length !== 1) {
    errors.push(
      `Channel body "${body.name}" requires exactly one material assignment; found ${matchingAssignments.length}.`,
    );
    return {};
  }

  const assignment = matchingAssignments[0];
  const assignmentSelection = ir.named_selections.find(
    (candidate) => candidate.id === assignment.target_named_selection_id,
  );
  if (assignmentSelection?.status !== 'active') {
    errors.push(`Material assignment for channel body "${body.name}" uses a non-active named selection.`);
  }

  const material = ir.materials.find((candidate) => candidate.id === assignment.material_id);
  if (!material) {
    errors.push(`Material assignment "${assignment.id}" references missing material "${assignment.material_id}".`);
    return { assignmentId: assignment.id, assignmentSelectionId: assignment.target_named_selection_id };
  }
  if (material.class !== 'fluid_newtonian'
      || material.physical_model !== 'incompressible_newtonian') {
    errors.push(
      `Assigned material "${material.name}" must be an incompressible Newtonian fluid for simpleFoam.`,
    );
    return {
      material,
      assignmentId: assignment.id,
      assignmentSelectionId: assignment.target_named_selection_id,
    };
  }
  if (analysisCase
      && analysisCase.participating_material_ids.length > 0
      && !analysisCase.participating_material_ids.includes(material.id)) {
    errors.push(
      `Assigned material "${material.name}" is not included in analysis case "${analysisCase.name}".`,
    );
  }
  for (const participatingId of analysisCase?.participating_material_ids ?? []) {
    if (!ir.materials.some((candidate) => candidate.id === participatingId)) {
      errors.push(`Analysis case references missing participating material "${participatingId}".`);
    } else if (participatingId !== material.id) {
      errors.push(`Participating material "${participatingId}" is not consumed by the exported channel body.`);
    }
  }

  const density = trackedPositiveValue(material, 'density', errors);
  const dynamicViscosity = trackedPositiveValue(material, 'dynamic_viscosity', errors);
  const specifiedKinematicViscosity = trackedPositiveValue(material, 'kinematic_viscosity', errors);

  let derivedKinematicViscosity: number | undefined;
  if (dynamicViscosity !== undefined) {
    if (density === undefined) {
      errors.push(
        `Material "${material.name}" needs a valid density to convert dynamic viscosity to kinematic viscosity.`,
      );
    } else {
      derivedKinematicViscosity = dynamicViscosity / density;
      if (!Number.isFinite(derivedKinematicViscosity) || derivedKinematicViscosity <= 0) {
        errors.push(
          `Material "${material.name}" produces an invalid kinematic viscosity from dynamic viscosity and density.`,
        );
        derivedKinematicViscosity = undefined;
      }
    }
  }

  if (specifiedKinematicViscosity !== undefined && derivedKinematicViscosity !== undefined) {
    const relativeDifference = Math.abs(specifiedKinematicViscosity - derivedKinematicViscosity)
      / Math.max(specifiedKinematicViscosity, derivedKinematicViscosity);
    if (relativeDifference > 0.02) {
      errors.push(
        `Material "${material.name}" has inconsistent viscosity values: nu=${specifiedKinematicViscosity} m^2/s but mu/rho=${derivedKinematicViscosity} m^2/s.`,
      );
    }
  }

  const kinematicViscosity = specifiedKinematicViscosity ?? derivedKinematicViscosity;
  if (kinematicViscosity === undefined) {
    errors.push(
      `Material "${material.name}" needs a confirmed positive kinematic viscosity or dynamic viscosity with density.`,
    );
  }

  return {
    material,
    assignmentId: assignment.id,
    assignmentSelectionId: assignment.target_named_selection_id,
    density,
    kinematicViscosity,
  };
}

function validateBlockMeshControls(ir: ProjectIR, errors: string[]): number | undefined {
  const initialErrorCount = errors.length;
  const global = ir.mesh_controls.global;
  const quality = ir.mesh_controls.quality_targets;
  const unsupportedSettings: Array<[string, unknown, unknown]> = [
    ['mesh_controls.global.algorithm_preference', global.algorithm_preference, DEFAULT_MESH_SETTINGS.algorithm_preference],
    ['mesh_controls.global.growth_rate', global.growth_rate, DEFAULT_MESH_SETTINGS.growth_rate],
    ['mesh_controls.global.element_order', global.element_order, DEFAULT_MESH_SETTINGS.element_order],
    ['mesh_controls.global.recombine_preference', global.recombine_preference, DEFAULT_MESH_SETTINGS.recombine_preference],
    ['mesh_controls.global.curvature_based_refinement', global.curvature_based_refinement, DEFAULT_MESH_SETTINGS.curvature_based_refinement],
    ['mesh_controls.quality_targets.min_jacobian', quality.min_jacobian, DEFAULT_MESH_SETTINGS.min_jacobian],
    ['mesh_controls.quality_targets.max_aspect_ratio', quality.max_aspect_ratio, DEFAULT_MESH_SETTINGS.max_aspect_ratio],
    ['mesh_controls.quality_targets.min_skewness', quality.min_skewness, DEFAULT_MESH_SETTINGS.min_skewness],
    ['mesh_controls.quality_targets.preferred_quality_level', quality.preferred_quality_level, DEFAULT_MESH_SETTINGS.preferred_quality_level],
  ];
  for (const [path, actual, supportedDefault] of unsupportedSettings) {
    if (!Object.is(actual, supportedDefault)) {
      errors.push(
        `OpenFOAM blockMesh export does not consume ${path}; set it to the supported default ${JSON.stringify(supportedDefault)} instead of ${JSON.stringify(actual)}.`,
      );
    }
  }

  const meshSize = global.global_size;
  if (meshSize === null) {
    errors.push('OpenFOAM strict export requires an explicit positive global mesh size; no default was inferred.');
  } else if (!Number.isFinite(meshSize) || meshSize <= 0) {
    errors.push('OpenFOAM global mesh size must be finite and greater than zero.');
  }
  for (const control of ir.mesh_controls.local) {
    errors.push(`OpenFOAM blockMesh export does not consume local mesh control "${control.id}" (${control.control_type}).`);
  }

  return errors.length === initialErrorCount && meshSize !== null ? meshSize : undefined;
}

function normalizePressureBasis(value: unknown): PressureBasis | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'dynamic' || normalized === 'kinematic') return normalized;
  return undefined;
}

function resolvePressure(
  outletBC: BoundaryCondition | undefined,
  solverOptions: Record<string, unknown>,
  density: number | undefined,
  errors: string[],
  warnings: string[],
): ResolvedPressure | undefined {
  if (!outletBC) return undefined;
  const inputValue = outletBC.values.scalar;
  if (inputValue === undefined || !Number.isFinite(inputValue)) {
    errors.push(`Pressure outlet "${outletBC.name}" needs a finite scalar value.`);
    return undefined;
  }

  const legacyBC = outletBC as BoundaryCondition & {
    pressure_basis?: unknown;
    pressure_kind?: unknown;
    pressure_type?: unknown;
  };
  const legacyValues = outletBC.values as BoundaryCondition['values'] & {
    pressure_kind?: unknown;
    pressure_type?: unknown;
  };
  const candidates = [
    { source: 'BC values.pressure_basis', value: outletBC.values.pressure_basis },
    { source: 'BC values.pressure_kind', value: legacyValues.pressure_kind },
    { source: 'BC values.pressure_type', value: legacyValues.pressure_type },
    { source: 'BC pressure_basis', value: legacyBC.pressure_basis },
    { source: 'BC pressure_kind', value: legacyBC.pressure_kind },
    { source: 'BC pressure_type', value: legacyBC.pressure_type },
    { source: 'solver_options.pressure_basis', value: solverOptions.pressure_basis },
    { source: 'solver_options.pressure_kind', value: solverOptions.pressure_kind },
    { source: 'solver_options.pressure_type', value: solverOptions.pressure_type },
  ].filter((candidate) => candidate.value !== undefined);

  const resolvedCandidates: Array<{ source: string; basis: PressureBasis }> = [];
  for (const candidate of candidates) {
    const basis = normalizePressureBasis(candidate.value);
    if (!basis) {
      errors.push(`${candidate.source} must be dynamic or kinematic.`);
    } else {
      resolvedCandidates.push({ source: candidate.source, basis });
    }
  }

  const distinctBases = new Set(resolvedCandidates.map((candidate) => candidate.basis));
  if (distinctBases.size > 1) {
    errors.push(`Conflicting pressure bases: ${resolvedCandidates
      .map((candidate) => `${candidate.source}=${candidate.basis}`)
      .join(', ')}.`);
    return undefined;
  }

  let basis = resolvedCandidates[0]?.basis;
  if (!basis) {
    if (inputValue !== 0) {
      errors.push(
        `Pressure outlet "${outletBC.name}" has a non-zero value but no dynamic/kinematic pressure basis.`,
      );
      return undefined;
    }
    basis = 'kinematic';
    warnings.push(
      `Pressure outlet "${outletBC.name}" has no pressure basis; zero is conversion-invariant and is emitted as kinematic pressure.`,
    );
  }

  if (basis === 'dynamic') {
    if (density === undefined) {
      errors.push(
        `Pressure outlet "${outletBC.name}" uses dynamic pressure but the assigned fluid has no valid density.`,
      );
      return undefined;
    }
    const kinematicValue = inputValue / density;
    if (!Number.isFinite(kinematicValue)) {
      errors.push(`Pressure outlet "${outletBC.name}" overflows during dynamic-to-kinematic conversion.`);
      return undefined;
    }
    return { inputValue, basis, kinematicValue };
  }
  return { inputValue, basis, kinematicValue: inputValue };
}

function resolveInletVelocity(
  inletBC: BoundaryCondition | undefined,
  errors: string[],
): [number, number, number] | undefined {
  if (!inletBC) return undefined;
  const vector = inletBC.values.vector;
  if (!vector || vector.length !== 3 || vector.some((value) => !Number.isFinite(value))) {
    errors.push(`Velocity inlet "${inletBC.name}" needs a finite three-component vector.`);
    return undefined;
  }
  if (inletBC.status === 'missing' || inletBC.status === 'needs_review') {
    errors.push(`Velocity inlet "${inletBC.name}" is not confirmed for export.`);
  }
  if (inletBC.temporal_profile !== 'constant') {
    errors.push(`Velocity inlet "${inletBC.name}" must use a constant profile for simpleFoam.`);
  }
  if (inletBC.coordinate_system !== 'global') {
    errors.push(`Velocity inlet "${inletBC.name}" must use the global coordinate system.`);
  }
  return vector;
}

function validateInletVelocityDirection(
  body: GeometryBody,
  velocity: [number, number, number] | undefined,
  errors: string[],
): void {
  if (!velocity) return;
  const speed = Math.hypot(...velocity);
  if (!(speed > 0)) {
    errors.push('Velocity inlet magnitude must be greater than zero.');
    return;
  }

  const origin = applyTransformToPoint([0, 0, 0], body.transform);
  const axialPoint = applyTransformToPoint([1, 0, 0], body.transform);
  const axis: [number, number, number] = [
    axialPoint[0] - origin[0],
    axialPoint[1] - origin[1],
    axialPoint[2] - origin[2],
  ];
  const axisLength = Math.hypot(...axis);
  if (!(axisLength > 0) || !Number.isFinite(axisLength)) {
    errors.push('Channel transform does not define a finite inlet-to-outlet axis.');
    return;
  }
  const unitAxis = axis.map((component) => component / axisLength) as [number, number, number];
  const axialSpeed = velocity.reduce(
    (sum, component, index) => sum + component * unitAxis[index],
    0,
  );
  const tangentialSpeed = Math.sqrt(Math.max(0, speed ** 2 - axialSpeed ** 2));
  if (axialSpeed <= 0 || tangentialSpeed / speed > 1e-9) {
    errors.push(
      `Velocity inlet must point along the transformed channel inlet-to-outlet axis; received (${velocity.map(foamNumber).join(' ')}).`,
    );
  }
}

function renderBlockMeshDict(
  vertices: [number, number, number][],
  cells: { nx: number; ny: number; nz: number },
  convertToMeters: number,
  patches: ResolvedPatches,
): string {
  return `${foamHeader('dictionary', 'blockMeshDict', 'system')}

convertToMeters ${foamNumber(convertToMeters)};

vertices
(
${vertices.map((vertex) => `    (${vertex.map(foamNumber).join(' ')})`).join('\n')}
);

blocks
(
    hex (0 1 2 3 4 5 6 7) (${cells.nx} ${cells.ny} ${cells.nz}) simpleGrading (1 1 1)
);

edges
(
);

boundary
(
    ${patches.inlet.name}
    {
        type patch;
        faces
        (
            (0 4 7 3)
        );
    }
    ${patches.outlet.name}
    {
        type patch;
        faces
        (
            (2 6 5 1)
        );
    }
    ${patches.wallTop.name}
    {
        type wall;
        faces
        (
            (3 7 6 2)
        );
    }
    ${patches.wallBottom.name}
    {
        type wall;
        faces
        (
            (1 5 4 0)
        );
    }
    ${patches.frontAndBack.name}
    {
        type ${patches.frontAndBack.type};
        faces
        (
            (0 3 2 1)
            (4 5 6 7)
        );
    }
);
`;
}

function renderVelocityField(
  patches: ResolvedPatches,
  inletVelocity: [number, number, number],
): string {
  const frontBackCondition = patches.frontAndBack.type === 'empty'
    ? 'type            empty;'
    : patches.frontAndBack.type === 'wall'
      ? 'type            noSlip;'
      : 'type            zeroGradient;';
  return `${foamHeader('volVectorField', 'U', '0')}

dimensions      [0 1 -1 0 0 0 0];

internalField   uniform (0 0 0);

boundaryField
{
    ${patches.inlet.name}
    {
        type            fixedValue;
        value           uniform (${inletVelocity.map(foamNumber).join(' ')});
    }
    ${patches.outlet.name}
    {
        type            zeroGradient;
    }
    ${patches.wallTop.name}
    {
        type            noSlip;
    }
    ${patches.wallBottom.name}
    {
        type            noSlip;
    }
    ${patches.frontAndBack.name}
    {
        ${frontBackCondition}
    }
}
`;
}

function renderPressureField(patches: ResolvedPatches, pressure: number): string {
  const frontBackCondition = patches.frontAndBack.type === 'empty'
    ? 'type            empty;'
    : 'type            zeroGradient;';
  return `${foamHeader('volScalarField', 'p', '0')}

dimensions      [0 2 -2 0 0 0 0];

internalField   uniform 0;

boundaryField
{
    ${patches.inlet.name}
    {
        type            zeroGradient;
    }
    ${patches.outlet.name}
    {
        type            fixedValue;
        value           uniform ${foamNumber(pressure)};
    }
    ${patches.wallTop.name}
    {
        type            zeroGradient;
    }
    ${patches.wallBottom.name}
    {
        type            zeroGradient;
    }
    ${patches.frontAndBack.name}
    {
        ${frontBackCondition}
    }
}
`;
}

function renderTransportProperties(kinematicViscosity: number): string {
  return `${foamHeader('dictionary', 'transportProperties', 'constant')}

transportModel  Newtonian;

nu              [0 2 -1 0 0 0 0] ${foamNumber(kinematicViscosity)};
`;
}

function renderTurbulenceProperties(): string {
  return `${foamHeader('dictionary', 'turbulenceProperties', 'constant')}

simulationType  laminar;
`;
}

function renderControlDict(): string {
  return `${foamHeader('dictionary', 'controlDict', 'system')}

application     simpleFoam;

startFrom       startTime;
startTime       0;
stopAt          endTime;
endTime         1000;
deltaT          1;

writeControl    timeStep;
writeInterval   100;

purgeWrite      3;
writeFormat     ascii;
writePrecision  6;
writeCompression off;

timeFormat      general;
timePrecision   6;

runTimeModifiable true;
`;
}

function renderFvSchemes(): string {
  return `${foamHeader('dictionary', 'fvSchemes', 'system')}

ddtSchemes
{
    default         steadyState;
}

gradSchemes
{
    default         Gauss linear;
}

divSchemes
{
    default         none;
    div(phi,U)      bounded Gauss linearUpwind grad(U);
    div((nuEff*dev2(T(grad(U))))) Gauss linear;
}

laplacianSchemes
{
    default         Gauss linear corrected;
}

interpolationSchemes
{
    default         linear;
}

snGradSchemes
{
    default         corrected;
}
`;
}

function renderFvSolution(): string {
  return `${foamHeader('dictionary', 'fvSolution', 'system')}

solvers
{
    p
    {
        solver          GAMG;
        tolerance       1e-06;
        relTol          0.1;
        smoother        GaussSeidel;
    }

    U
    {
        solver          smoothSolver;
        smoother        GaussSeidel;
        tolerance       1e-05;
        relTol          0.1;
    }
}

SIMPLE
{
    nNonOrthogonalCorrectors 0;
    consistent      yes;

    residualControl
    {
        p               1e-4;
        U               1e-4;
    }
}

relaxationFactors
{
    fields
    {
        p               0.3;
    }
    equations
    {
        U               0.7;
    }
}
`;
}

export function exportOpenFOAM(ir: ProjectIR): OpenFOAMExportResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const target = ir.solver_targets.find((candidate) => candidate.target_name === 'OpenFOAM');
  const solverOptions = target?.solver_options ?? {};
  const analysisCase = validateSolverSelection(ir, target, errors);

  const fluidBodies = ir.geometry.bodies.filter((body) => body.category === 'fluid_region');
  if (fluidBodies.length === 0) {
    errors.push('No fluid region geometry found.');
    return earlyFailure(ir, errors, warnings);
  }
  if (fluidBodies.length > 1) {
    errors.push(`OpenFOAM single-region channel export supports exactly one fluid body; found ${fluidBodies.length}.`);
    return earlyFailure(ir, errors, warnings);
  }

  const body = fluidBodies[0];
  if (body.metadata.shapeType !== 'channel') {
    errors.push(
      `Unsupported fluid geometry "${String(body.metadata.shapeType ?? body.name)}"; only native channel bodies are supported.`,
    );
    return earlyFailure(ir, errors, warnings);
  }

  const dimensions = {
    length: body.metadata.length,
    height: body.metadata.height,
    depth: body.metadata.depth,
  };
  for (const [name, value] of Object.entries(dimensions)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      errors.push(`Channel ${name} must be a finite number greater than zero.`);
    }
  }
  if (errors.some((error) => error.startsWith('Channel '))) {
    return earlyFailure(ir, errors, warnings);
  }
  const L = dimensions.length as number;
  const H = dimensions.height as number;
  const D = dimensions.depth as number;

  for (const [axis, value] of body.transform.scale.entries()) {
    if (!Number.isFinite(value) || value <= 0) {
      errors.push(`Channel transform scale[${axis}] must be finite and greater than zero.`);
    }
  }
  for (const [field, values] of [
    ['position', body.transform.position],
    ['rotation', body.transform.rotation],
  ] as const) {
    if (values.some((value) => !Number.isFinite(value))) {
      errors.push(`Channel transform ${field} must contain only finite values.`);
    }
  }
  if (errors.some((error) => error.startsWith('Channel transform'))) {
    return earlyFailure(ir, errors, warnings);
  }

  const { mode, frontBackType } = resolveSimulationMode(
    body,
    solverOptions,
    errors,
  );
  const convertToMeters = resolveConvertToMeters(ir, errors, warnings);
  if (convertToMeters === undefined) return earlyFailure(ir, errors, warnings);

  const scaledDimensions = {
    length: L * body.transform.scale[0],
    height: H * body.transform.scale[1],
    depth: D * body.transform.scale[2],
  };
  const meshSize = validateBlockMeshControls(ir, errors);
  if (meshSize === undefined) return earlyFailure(ir, errors, warnings);

  const nx = Math.max(Math.ceil(scaledDimensions.length / meshSize), 2);
  const ny = Math.max(Math.ceil(scaledDimensions.height / meshSize), 2);
  const nz = mode === '2D' ? 1 : Math.max(Math.ceil(scaledDimensions.depth / meshSize), 2);
  const totalCells = nx * ny * nz;
  if ([nx, ny, nz].some((count) => !Number.isSafeInteger(count) || count > MAX_CELLS_PER_DIRECTION)
      || !Number.isSafeInteger(totalCells)
      || totalCells > MAX_TOTAL_CELLS) {
    errors.push(
      `Requested block mesh (${nx} x ${ny} x ${nz} = ${totalCells} cells) exceeds safe exporter limits.`,
    );
    return earlyFailure(ir, errors, warnings);
  }

  const patches = resolvePatches(
    ir,
    body,
    analysisCase,
    frontBackType,
    solverOptions,
    errors,
    warnings,
  );
  if (!patches.unique) return earlyFailure(ir, errors, warnings);

  const material = resolveMaterialProperties(ir, body, analysisCase, errors);
  const inletVelocity = resolveInletVelocity(patches.inlet.bc, errors);
  validateInletVelocityDirection(body, inletVelocity, errors);
  const pressure = resolvePressure(
    patches.outlet.bc,
    solverOptions,
    material.density,
    errors,
    warnings,
  );
  const hydraulicDiameter = (mode === '2D'
    ? 2 * scaledDimensions.height
    : 2 * scaledDimensions.height * scaledDimensions.depth
      / (scaledDimensions.height + scaledDimensions.depth)) * convertToMeters;
  const reynoldsNumber = inletVelocity && material.kinematicViscosity !== undefined
    ? Math.hypot(...inletVelocity) * hydraulicDiameter / material.kinematicViscosity
    : null;
  if (reynoldsNumber !== null && (!Number.isFinite(reynoldsNumber) || reynoldsNumber >= 2300)) {
    errors.push(
      `OpenFOAM laminar channel profile requires Reynolds number below 2300; calculated Re=${foamNumber(reynoldsNumber)}. Turbulence models are not implemented.`,
    );
  }

  if (patches.outlet.bc
      && (patches.outlet.bc.status === 'missing' || patches.outlet.bc.status === 'needs_review')) {
    errors.push(`Pressure outlet "${patches.outlet.bc.name}" is not confirmed for export.`);
  }
  if (patches.outlet.bc?.temporal_profile !== undefined
      && patches.outlet.bc.temporal_profile !== 'constant') {
    errors.push(`Pressure outlet "${patches.outlet.bc.name}" must use a constant profile for simpleFoam.`);
  }

  const localVertices: [number, number, number][] = [
    [-L / 2, -H / 2, -D / 2],
    [L / 2, -H / 2, -D / 2],
    [L / 2, H / 2, -D / 2],
    [-L / 2, H / 2, -D / 2],
    [-L / 2, -H / 2, D / 2],
    [L / 2, -H / 2, D / 2],
    [L / 2, H / 2, D / 2],
    [-L / 2, H / 2, D / 2],
  ];
  const transformedVertices = localVertices.map((vertex) =>
    applyTransformToPoint(vertex, body.transform));
  if (transformedVertices.some((vertex) => vertex.some((value) => !Number.isFinite(value)))) {
    errors.push('Channel transform produces non-finite blockMesh vertex coordinates.');
    return earlyFailure(ir, errors, warnings);
  }

  // A geometry-only preview remains available when physics preflight fails, but
  // downloadOpenFOAMZip refuses to package it because success remains false.
  const files: Record<string, string> = {
    'system/blockMeshDict': renderBlockMeshDict(
      transformedVertices,
      { nx, ny, nz },
      convertToMeters,
      patches,
    ),
  };

  if (errors.length === 0
      && inletVelocity
      && pressure
      && material.kinematicViscosity !== undefined) {
    files['0/U'] = renderVelocityField(patches, inletVelocity);
    files['0/p'] = renderPressureField(patches, pressure.kinematicValue);
    files['constant/transportProperties'] = renderTransportProperties(material.kinematicViscosity);
    files['constant/turbulenceProperties'] = renderTurbulenceProperties();
    files['system/controlDict'] = renderControlDict();
    files['system/fvSchemes'] = renderFvSchemes();
    files['system/fvSolution'] = renderFvSolution();
  }

  const consumedIrIds = new Set([
    body.id,
    analysisCase?.id,
    material.material?.id,
    material.assignmentId,
    material.assignmentSelectionId,
    patches.inlet.bc?.id,
    patches.inlet.selection?.id,
    patches.inlet.face?.id,
    patches.outlet.bc?.id,
    patches.outlet.selection?.id,
    patches.outlet.face?.id,
    patches.wallTop.bc?.id,
    patches.wallTop.selection?.id,
    patches.wallTop.face?.id,
    patches.wallBottom.bc?.id,
    patches.wallBottom.selection?.id,
    patches.wallBottom.face?.id,
    'mesh_controls.global',
    ...(analysisCase?.result_requests.map(
      (request) => `result_request:${analysisCase.id}:${request}`,
    ) ?? []),
  ].filter((id): id is string => id !== undefined));
  const scopedIrIds = [
    ...ir.geometry.bodies.map((item) => item.id),
    ...ir.geometry.faces.map((item) => item.id),
    ...ir.geometry.edges.map((item) => item.id),
    ...ir.geometry.vertices.map((item) => item.id),
    ...ir.named_selections.map((item) => item.id),
    ...ir.materials.map((item) => item.id),
    ...ir.material_assignments.map((item) => item.id),
    ...ir.sections.map((item) => item.id),
    ...ir.section_assignments.map((item) => item.id),
    ...ir.mesh_controls.local.map((item) => item.id),
    ...ir.boundary_conditions.map((item) => item.id),
    ...ir.loads.map((item) => item.id),
    ...ir.initial_conditions.map((item) => item.id),
    ...ir.analysis_cases.map((item) => item.id),
    ...ir.analysis_cases.flatMap((item) => item.result_requests.map(
      (request) => `result_request:${item.id}:${request}`,
    )),
  ];
  const ignoredIrIds = [...new Set(scopedIrIds)].filter((id) => !consumedIrIds.has(id));

  const manifest = makeManifest({
    export_target: 'OpenFOAM',
    export_time: new Date().toISOString(),
    source_project: ir.meta.project_name,
    schema_version: ir.meta.schema_version,
    model_revision: ir.validation.model_revision,
    solver: 'simpleFoam',
    analysis_case_id: analysisCase?.id ?? null,
    mesh: 'blockMesh',
    dimensionality: mode,
    convert_to_meters: convertToMeters,
    domain: { length: L, height: H, depth: D },
    scaled_domain: scaledDimensions,
    transform: body.transform,
    cells: { nx, ny, nz, total: totalCells },
    patches: {
      inlet: patches.inlet.name,
      outlet: patches.outlet.name,
      wallTop: patches.wallTop.name,
      wallBottom: patches.wallBottom.name,
      frontAndBack: patches.frontAndBack.name,
      frontAndBackType: patches.frontAndBack.type,
    },
    material: material.material ? {
      id: material.material.id,
      density: material.density ?? null,
      kinematic_viscosity: material.kinematicViscosity ?? null,
    } : null,
    pressure: pressure ? {
      input_value: pressure.inputValue,
      input_basis: pressure.basis,
      emitted_kinematic_value: pressure.kinematicValue,
    } : null,
    hydraulic_diameter_m: hydraulicDiameter,
    reynolds_number: reynoldsNumber,
    mesh_control_coverage: {
      consumed_fields: ['mesh_controls.global.global_size'],
      validated_but_not_consumed_fields: VALIDATED_BUT_NOT_CONSUMED_MESH_FIELDS,
    },
    consumed_ir_ids: [...consumedIrIds],
    ignored_ir_ids: ignoredIrIds,
    generated_files: [...Object.keys(files), 'export_manifest.json', 'run.sh', 'README.txt', 'result_manifest.json (runtime)'],
    warnings,
    errors,
  });

  return { success: errors.length === 0, files, manifest, errors, warnings };
}

function renderOpenFOAMRunScript(ir: ProjectIR): string {
  const analysisCase = ir.analysis_cases.find(
    (item) => item.active && item.solver_profile_hint === 'openfoam_simpleFoam',
  );
  const resultManifest = JSON.stringify({
    export_target: 'OpenFOAM',
    analysis_case_id: analysisCase?.id ?? null,
    model_revision: ir.validation.model_revision,
    solver: 'simpleFoam',
    execution_return_code: 0,
    numerical_convergence: 'not_evaluated',
  }, null, 2);
  return `#!/usr/bin/env bash
set -euo pipefail
blockMesh
checkMesh | tee checkMesh.log
simpleFoam | tee solver.log
cat > result_manifest.json <<'RESULT_MANIFEST'
${resultManifest}
RESULT_MANIFEST
`;
}

export async function downloadOpenFOAMZip(
  ir: ProjectIR,
  analysisCaseId?: string,
): Promise<OpenFOAMExportResult> {
  const exportIr = analysisCaseId ? scopeProjectForAnalysisCaseValidation(ir, analysisCaseId) : ir;
  const result = exportOpenFOAM(exportIr);
  if (!result.success && result.errors.length > 0) return result;

  const zip = new JSZip();
  for (const [path, content] of Object.entries(result.files)) {
    zip.file(path, content);
  }
  zip.file('export_manifest.json', result.manifest);
  zip.file('run.sh', renderOpenFOAMRunScript(exportIr));
  zip.file('README.txt', 'Requires a compatible OpenFOAM environment. Run: bash run.sh\ncheckMesh must complete successfully before simpleFoam starts.\n');

  const blob = await zip.generateAsync({ type: 'blob' });
  saveAs(blob, `${sanitizeArtifactName(ir.meta.project_name)}_openfoam.zip`);
  return result;
}
