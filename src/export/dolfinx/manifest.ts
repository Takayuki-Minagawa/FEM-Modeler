import type {
  ProjectIR
} from '@/core/ir/types';
import type { DOLFINxExportResult, ExportContext, PhysicsMode } from './model';

export function buildManifest(
  context: ExportContext,
  exportTime: string,
  errors: string[],
  warnings: string[],
): string {
  const consumedIds = [
    context.body.id,
    context.material.id,
    context.materialAssignmentId,
    context.materialSelectionId,
    'mesh_controls.global',
    ...(context.analysisCase ? [context.analysisCase.id] : []),
    ...context.boundaryConditions.map((bc) => bc.id),
    ...context.loads.map((load) => load.id),
    ...context.boundaryConditions.map((bc) => bc.target_named_selection_id),
    ...context.loads.map((load) => load.target_named_selection_id),
    ...context.surfaceSelections.keys(),
    ...[...context.surfaceSelections.values()].flatMap((selection) =>
      selection.faces.map((face) => face.id)),
    ...(context.analysisCase?.result_requests.map(
      (request) => `result_request:${context.analysisCase!.id}:${request}`,
    ) ?? []),
  ];
  const consumedIdSet = new Set(consumedIds);
  const scopedIds = [
    ...context.ir.geometry.bodies.map((body) => body.id),
    ...context.ir.geometry.faces.map((face) => face.id),
    ...context.ir.geometry.edges.map((edge) => edge.id),
    ...context.ir.geometry.vertices.map((vertex) => vertex.id),
    ...context.ir.named_selections.map((selection) => selection.id),
    ...context.ir.materials.map((material) => material.id),
    ...context.ir.material_assignments.map((assignment) => assignment.id),
    ...context.ir.sections.map((section) => section.id),
    ...context.ir.section_assignments.map((assignment) => assignment.id),
    ...context.ir.mesh_controls.local.map((control) => control.id),
    ...context.ir.boundary_conditions.map((bc) => bc.id),
    ...context.ir.loads.map((load) => load.id),
    ...context.ir.initial_conditions.map((condition) => condition.id),
    ...context.ir.analysis_cases.map((analysisCase) => analysisCase.id),
    ...context.ir.analysis_cases.flatMap((analysisCase) => analysisCase.result_requests.map(
      (request) => `result_request:${analysisCase.id}:${request}`,
    )),
  ];
  const ignoredIds = [...new Set(scopedIds)].filter((id) => !consumedIdSet.has(id));
  return JSON.stringify({
    ...context.provenance,
    dolfinx_api_version: '0.10',
    gmsh_min_version: '4.15',
    export_time: exportTime,
    source_project: context.ir.meta.project_name,
    schema_version: context.ir.meta.schema_version,
    model_revision: context.ir.validation.model_revision,
    analysis_type: context.mode === 'thermal' ? 'steady_heat_or_poisson' : 'linear_elasticity',
    analysis_case_id: context.analysisCase?.id ?? null,
    body_id: context.body.id,
    material_id: context.material.id,
    material_assignment_id: context.materialAssignmentId,
    heat_flux_sign_convention: context.mode === 'thermal' ? 'positive_outward' : null,
    tag_map_key: 'named_selection_id',
    tag_map: context.tagMap,
    mesh_control_coverage: {
      consumed_fields: [
        'mesh_controls.global.global_size',
        'mesh_controls.global.algorithm_preference',
        'mesh_controls.global.element_order',
        'mesh_controls.global.curvature_based_refinement',
      ],
      validated_but_not_consumed_fields: [
        'mesh_controls.global.growth_rate',
        'mesh_controls.global.recombine_preference',
        'mesh_controls.quality_targets.min_jacobian',
        'mesh_controls.quality_targets.max_aspect_ratio',
        'mesh_controls.quality_targets.min_skewness',
        'mesh_controls.quality_targets.preferred_quality_level',
      ],
    },
    consumed_ir_ids: [...consumedIdSet],
    ignored_ir_ids: ignoredIds,
    generated_files: ['solve.py', 'model.geo', 'export_manifest.json', 'run.sh', 'README.txt', 'runtime/lifecycle.sh', 'runtime/failure_manifest.json', 'pyproject.toml', 'uv.lock', '.python-version', 'result_manifest.json (runtime)', 'result_package.json (runtime)'],
    errors,
    warnings,
  }, null, 2);
}

export function failedResult(
  ir: ProjectIR,
  exportTime: string,
  errors: string[],
  warnings: string[],
  geoFile = '',
  mode?: PhysicsMode,
  tagMap: Record<string, number> = {},
): DOLFINxExportResult {
  return {
    success: false,
    script: '',
    geoFile,
    manifest: JSON.stringify({
      export_target: 'DOLFINx',
      dolfinx_api_version: '0.10',
      export_time: exportTime,
      source_project: ir.meta.project_name,
      schema_version: ir.meta.schema_version,
      analysis_type: mode ?? null,
      tag_map: tagMap,
      errors,
      warnings,
    }, null, 2),
    errors,
    warnings,
  };
}
