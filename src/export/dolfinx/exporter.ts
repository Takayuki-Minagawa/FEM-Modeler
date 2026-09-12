import { createExportProvenance } from '@/core/ir/provenance';
import type {
  ProjectIR
} from '@/core/ir/types';
import { buildGeoFile } from './geometry';
import { safeComment } from './helpers';
import { buildManifest, failedResult } from './manifest';
import type { DOLFINxExportResult, ExportContext, SupportedShapeType } from './model';
import { buildSolverScript } from './render';
import { resolveAnalysisCase, resolveAssignedMaterial, resolveParticipatingItems, resolveShapeDefinition, resolveSurfaceSelections, SUPPORTED_SHAPES, validateBoundaryConditions, validateBoundaryConflicts, validateLoads, validateMaterial, validateMeshControls, validateTransform, validateWellPosedness } from './resolve';

/**
 * Compile a strict, single-volume DOLFINx 0.10 model.
 *
 * The exporter intentionally rejects unresolved assignments and unsupported IR
 * items. It never replaces an unsupported body with a box and never guesses a
 * Gmsh surface tag from an array index.
 */
export function exportDOLFINx(ir: ProjectIR): DOLFINxExportResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const exportTime = new Date().toISOString();
  const candidates = ir.geometry.bodies.filter(
    (candidate) => candidate.category === 'solid' || candidate.category === 'shell',
  );

  if (candidates.length === 0) {
    errors.push('DFX_GEOMETRY_REQUIRED: Exactly one solid body is required; none was found.');
    return failedResult(ir, exportTime, errors, warnings);
  }
  if (candidates.length > 1) {
    errors.push(
      `DFX_MULTIPLE_BODIES: Exactly one solid body is supported; found ${candidates.length}.`,
    );
    return failedResult(ir, exportTime, errors, warnings);
  }
  if (ir.geometry.bodies.length !== 1) {
    errors.push(
      `DFX_BODY_SCOPE_UNRESOLVED: Strict DOLFINx export requires exactly one geometry body; found ${ir.geometry.bodies.length}.`,
    );
    return failedResult(ir, exportTime, errors, warnings);
  }

  const body = candidates[0];
  if (body.category !== 'solid') {
    errors.push(`DFX_UNSUPPORTED_BODY_CATEGORY: Body "${safeComment(body.name)}" is a ${body.category}; only volumetric solids are supported.`);
    return failedResult(ir, exportTime, errors, warnings);
  }

  const shapeType = body.metadata.shapeType;
  if (typeof shapeType !== 'string' || !SUPPORTED_SHAPES.has(shapeType as SupportedShapeType)) {
    errors.push(
      `DFX_UNSUPPORTED_SHAPE: Body "${safeComment(body.name)}" uses unsupported shape "${String(shapeType)}". Supported shapes: box, plate, plateWithHole, cylinder.`,
    );
    return failedResult(ir, exportTime, errors, warnings);
  }

  validateTransform(body, errors);
  const shape = resolveShapeDefinition(body, shapeType as SupportedShapeType, errors);
  if (!shape) return failedResult(ir, exportTime, errors, warnings);

  const { mode, analysisCase } = resolveAnalysisCase(ir, errors);
  if (ir.sections.length > 0 || ir.section_assignments.length > 0) {
    errors.push(
      `DFX_UNSUPPORTED_SECTION: Volumetric DOLFINx analysis does not consume sections or section assignments (sections=${ir.sections.length}, assignments=${ir.section_assignments.length}).`,
    );
  }
  const boundaryConditions = resolveParticipatingItems(
    ir.boundary_conditions,
    analysisCase?.participating_bc_ids,
    mode,
    'boundary condition',
    errors,
  );
  const loads = resolveParticipatingItems(
    ir.loads,
    analysisCase?.participating_load_ids,
    mode,
    'load',
    errors,
  );

  const participatingInitialConditions = resolveParticipatingItems(
    ir.initial_conditions,
    analysisCase?.participating_ic_ids,
    mode,
    'initial condition',
    errors,
  );
  for (const initialCondition of participatingInitialConditions) {
    errors.push(
      `DFX_UNSUPPORTED_INITIAL_CONDITION: Initial condition "${safeComment(initialCondition.name)}" (${initialCondition.ic_type}) is not consumed by a steady DOLFINx analysis.`,
    );
  }

  const materialAssignment = resolveAssignedMaterial(ir, body, analysisCase, errors);
  if (materialAssignment) validateMaterial(materialAssignment.material, mode, errors);

  validateMeshControls(ir, analysisCase, errors);

  const requestedSurfaceSelectionIds = new Set<string>();
  validateBoundaryConditions(
    ir,
    body,
    mode,
    boundaryConditions,
    requestedSurfaceSelectionIds,
    errors,
  );
  validateLoads(ir, body, shape, mode, loads, requestedSurfaceSelectionIds, errors);
  validateWellPosedness(ir, mode, boundaryConditions, errors);

  const { selections, tagBySelectionId, tagMap } = resolveSurfaceSelections(
    ir,
    body,
    shape,
    requestedSurfaceSelectionIds,
    errors,
  );
  validateBoundaryConflicts(mode, boundaryConditions, tagBySelectionId, errors);
  const geoFile = buildGeoFile(ir, body, shape, selections);

  if (!materialAssignment || errors.length > 0) {
    return failedResult(ir, exportTime, errors, warnings, geoFile, mode, tagMap);
  }

  const context: ExportContext = {
    provenance: createExportProvenance(ir, 'DOLFINx', analysisCase?.id),
    ir,
    body,
    shape,
    mode,
    material: materialAssignment.material,
    materialAssignmentId: materialAssignment.assignmentId,
    materialSelectionId: materialAssignment.selectionId,
    analysisCase,
    boundaryConditions,
    loads,
    surfaceSelections: selections,
    tagBySelectionId,
    tagMap,
  };
  const script = buildSolverScript(context, exportTime);
  const manifest = buildManifest(context, exportTime, errors, warnings);

  return {
    success: true,
    script,
    geoFile,
    manifest,
    errors,
    warnings,
  };
}

export type * from './model';
export { downloadDOLFINxZip } from './package';
