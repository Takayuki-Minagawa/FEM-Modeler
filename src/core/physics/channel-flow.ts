import type { BoundaryCondition, GeometryBody, Material, NamedSelection, ProjectIR } from '@/core/ir/types';
import { applyTransformToPoint } from '@/geometry/transforms';

export type SimulationMode = '2D' | '3D';
export type FrontBackType = 'empty' | 'wall' | 'patch';
export const LAMINAR_CHANNEL_REYNOLDS_LIMIT = 2300;

export function normalizeMode(value: unknown): SimulationMode | undefined {
  if (value === 2) return '2D';
  if (value === 3) return '3D';
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (normalized === '2' || normalized === '2d' || normalized === 'twodimensional') return '2D';
  if (normalized === '3' || normalized === '3d' || normalized === 'threedimensional') return '3D';
  return undefined;
}

export function resolveSimulationMode(
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

  if (mode === '2D') {
    // OpenFOAM's empty-direction checks require the extrusion to remain on a
    // Cartesian axis. This exporter supports the XY plane for its 2D channel.
    const direction = applyTransformToPoint([0, 0, 1], { ...body.transform, position: [0, 0, 0] });
    const magnitude = Math.hypot(...direction);
    if (magnitude > 0 && Math.hypot(direction[0], direction[1]) / magnitude > 1e-9) {
      errors.push('OpenFOAM 2D channel out-of-plane rotation is unsupported; keep the extrusion parallel to the global Z axis or select 3D.');
    }
    return { mode, frontBackType: 'empty' };
  }
  return { mode, frontBackType: requestedFrontBackType ?? 'wall' };
}

export function trackedPositiveValue(
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

/** Shared viscosity precedence, confirmation checks and consistency tolerance. */
export function resolveFluidTransport(material: Material, errors: string[]): {
  density?: number;
  kinematicViscosity?: number;
} {
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

  return { density, kinematicViscosity };
}

/** Keep legacy coordinate conversion identical in the exporter and advisory calculations. */
export function resolveConvertToMeters(
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

/** Inputs are physical SI dimensions, including body scale; 2D depth is extrusion only. */
export function channelHydraulicDiameter(mode: SimulationMode, height: number, depth: number): number | null {
  if (!positive(height) || (mode === '3D' && !positive(depth))) return null;
  const diameter = mode === '2D' ? 2 * height : 2 * Math.min(height, depth) / (1 + Math.min(height, depth) / Math.max(height, depth));
  return positive(diameter) ? diameter : null;
}

export function channelReynoldsNumber(speed: number, hydraulicDiameter: number, viscosity: number): number | null {
  if (!Number.isFinite(speed) || speed < 0 || !positive(hydraulicDiameter) || !positive(viscosity)) return null;
  return speed * hydraulicDiameter / viscosity;
}

export function laminarChannelError(reynolds: number): string | null {
  return !Number.isFinite(reynolds) || reynolds >= LAMINAR_CHANNEL_REYNOLDS_LIMIT
    ? `OpenFOAM laminar channel profile requires Reynolds number below ${LAMINAR_CHANNEL_REYNOLDS_LIMIT}; calculated Re=${Number.isFinite(reynolds) ? Number(reynolds.toPrecision(15)) : String(reynolds)}. Turbulence models are not implemented.`
    : null;
}

export interface ChannelFlowMetric {
  body: GeometryBody;
  inlet: BoundaryCondition;
  material: Material;
  mode: SimulationMode;
  speed: number;
  hydraulicDiameter: number;
  kinematicViscosity: number;
  reynolds: number;
}

export interface ChannelFlowIssue { code: string; message: string; targetRef: string }

/** Resolve only the bodies/materials/conditions in an already scoped case view. */
export function evaluateChannelFlows(ir: ProjectIR): { metrics: ChannelFlowMetric[]; issues: ChannelFlowIssue[] } {
  const metrics: ChannelFlowMetric[] = [];
  const issues: ChannelFlowIssue[] = [];
  const unitErrors: string[] = [];
  const lengthScale = resolveConvertToMeters(ir, unitErrors, []);
  issues.push(...unitErrors.map((message) => ({ code: 'OFM_UNITS_INVALID', message, targetRef: 'units' })));
  if (lengthScale === undefined) return { metrics, issues };
  const options = ir.solver_targets.find((target) => target.target_name === 'OpenFOAM')?.solver_options ?? {};
  for (const body of ir.geometry.bodies.filter((item) => item.category === 'fluid_region' && item.metadata.shapeType === 'channel')) {
    const geometryErrors: string[] = [];
    validateChannelGeometry(body, geometryErrors);
    issues.push(...geometryErrors.map((message) => ({ code: 'OFM_CHANNEL_GEOMETRY_INVALID', message, targetRef: body.id })));
    if (geometryErrors.length > 0) continue;
    const modeErrors: string[] = [];
    const { mode } = resolveSimulationMode(body, options, modeErrors);
    issues.push(...modeErrors.map((message) => ({ code: 'OFM_DIMENSIONALITY_INVALID', message, targetRef: body.id })));
    if (modeErrors.length > 0) continue;
    const assignments = ir.material_assignments.filter((assignment) => ir.named_selections.some((selection) =>
      selection.id === assignment.target_named_selection_id && selection.status === 'active'
      && materialSelectionTargetsBody(selection, body)));
    if (assignments.length !== 1) continue;
    const material = ir.materials.find((item) => item.id === assignments[0].material_id);
    if (!material || material.class !== 'fluid_newtonian' || material.physical_model !== 'incompressible_newtonian') continue;
    const transportErrors: string[] = [];
    const { kinematicViscosity } = resolveFluidTransport(material, transportErrors);
    issues.push(...transportErrors.map((message) => ({ code: 'OFM_TRANSPORT_INVALID', message, targetRef: material.id })));
    if (kinematicViscosity === undefined || transportErrors.length > 0) continue;
    const height = Number(body.metadata.height) * body.transform.scale[1];
    const depth = Number(body.metadata.depth) * body.transform.scale[2];
    const hydraulicDiameter = channelHydraulicDiameter(mode, height * lengthScale, depth * lengthScale);
    if (hydraulicDiameter === null) {
      issues.push({ code: 'OFM_CHANNEL_GEOMETRY_INVALID', message: 'Channel hydraulic diameter must be finite and greater than zero.', targetRef: body.id });
      continue;
    }
    const inletFaces = new Set(ir.geometry.faces.filter((face) => face.body_id === body.id && face.name === 'inlet').map((face) => face.id));
    const inlets = ir.boundary_conditions.filter((bc) => bc.bc_type === 'velocity_inlet' && bc.physics_domain === 'fluid' && ir.named_selections.some((selection) =>
      selection.id === bc.target_named_selection_id && selection.status === 'active' && selection.entity_type === 'face' && selection.target_dimension === 2
      && selection.member_refs.length === 1 && inletFaces.has(selection.member_refs[0])));
    for (const inlet of inlets) {
      const inletErrors: string[] = [];
      const velocity = resolveInletVelocity(inlet, inletErrors);
      validateInletVelocityDirection(body, velocity, inletErrors);
      issues.push(...inletErrors.map((message) => ({ code: 'OFM_INLET_INVALID', message, targetRef: inlet.id })));
      if (!velocity || inletErrors.length > 0) continue;
      const speed = Math.hypot(...velocity);
      const reynolds = channelReynoldsNumber(speed, hydraulicDiameter, kinematicViscosity);
      if (reynolds === null) continue;
      const error = laminarChannelError(reynolds);
      if (error) issues.push({ code: 'OFM_REYNOLDS_UNSUPPORTED', message: error, targetRef: inlet.id });
      if (Number.isFinite(reynolds)) metrics.push({ body, inlet, material, mode, speed, hydraulicDiameter, kinematicViscosity, reynolds });
    }
  }
  return { metrics, issues };
}

export function materialSelectionTargetsBody(
  selection: NamedSelection | undefined,
  body: GeometryBody,
): boolean {
  return selection !== undefined
    && selection.target_dimension === 3
    && (selection.entity_type === 'body' || selection.entity_type === 'cell')
    && selection.member_refs.includes(body.id);
}

export function validateChannelGeometry(body: GeometryBody, errors: string[]): void {
  for (const [axis, name] of (['length', 'height', 'depth'] as const).entries()) {
    const value = body.metadata[name];
    if (typeof value !== 'number' || !positive(value)) errors.push(`Channel ${name} must be a finite number greater than zero.`);
    else if (positive(body.transform.scale[axis]) && !positive(value * body.transform.scale[axis])) errors.push(`Channel scaled ${name} must be finite and greater than zero.`);
  }
  for (const [axis, value] of body.transform.scale.entries()) {
    if (!positive(value)) errors.push(`Channel transform scale[${axis}] must be finite and greater than zero.`);
  }
  for (const field of ['position', 'rotation'] as const) {
    if (body.transform[field].some((value) => !Number.isFinite(value))) errors.push(`Channel transform ${field} must contain only finite values.`);
  }
}

export function resolveInletVelocity(
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

export function validateInletVelocityDirection(
  body: GeometryBody,
  velocity: [number, number, number] | undefined,
  errors: string[],
): void {
  if (!velocity) return;
  const speed = Math.hypot(...velocity);
  if (!(speed > 0) || !Number.isFinite(speed)) {
    errors.push('Velocity inlet magnitude must be finite and greater than zero.');
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
  const axialFraction = velocity.reduce(
    (sum, component, index) => sum + (component / speed) * unitAxis[index],
    0,
  );
  const tangentialFraction = Math.hypot(...velocity.map((component, index) => component / speed - axialFraction * unitAxis[index]));
  if (axialFraction <= 0 || tangentialFraction > 1e-9) {
    errors.push(
      `Velocity inlet must point along the transformed channel inlet-to-outlet axis; received (${velocity.map((value) => String(Number(value.toPrecision(15)))).join(' ')}).`,
    );
  }
}

function positive(value: number): boolean { return Number.isFinite(value) && value > 0; }
