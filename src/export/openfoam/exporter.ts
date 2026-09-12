import { renderSolverFiles } from './render';
import { createExportProvenance } from '@/core/ir/provenance';
import type {
  ProjectIR
} from '@/core/ir/types';
import { applyTransformToPoint } from '@/geometry/transforms';
import { earlyFailure, makeManifest } from './manifest';
import type { OpenFOAMExportResult } from './model';
import { foamNumber, renderBlockMeshDict } from './render';
import { MAX_CELLS_PER_DIRECTION, MAX_TOTAL_CELLS, resolveConvertToMeters, resolveInletVelocity, resolveMaterialProperties, resolvePatches, resolvePressure, resolveSimulationMode, validateBlockMeshControls, VALIDATED_BUT_NOT_CONSUMED_MESH_FIELDS, validateInletVelocityDirection, validateSolverSelection } from './resolve';

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
    Object.assign(files, renderSolverFiles({ patches, inletVelocity, outletKinematicPressure: pressure.kinematicValue, kinematicViscosity: material.kinematicViscosity }));
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
    ...(errors.length === 0 ? createExportProvenance(ir, 'OpenFOAM', analysisCase?.id) : {}),
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
    generated_files: [...Object.keys(files), 'export_manifest.json', 'run.sh', 'README.txt', 'runtime/lifecycle.sh', 'runtime/failure_manifest.json', 'pyproject.toml', 'uv.lock', '.python-version', 'collect_results.py', 'result_manifest.json (runtime)', 'result_package.json (runtime)'],
    warnings,
    errors,
  });

  return { success: errors.length === 0, files, manifest, errors, warnings };
}

export type * from './model';
export { downloadOpenFOAMZip } from './package';
