import { z } from 'zod';
import { tuple3NumberSchema, unknownRecordSchema, booleanRecordSchema } from './shared';
import { resultMeshSchema } from '@/results/package';
import { convergenceStudySchema } from '@/results/studies';

export const resultsSchema = z.array(z.strictObject({
    id: z.string(),
    analysis_case_id: z.string(),
    solver_target: z.enum(['OpenSeesPy', 'DOLFINx', 'OpenFOAM']),
    source_file_name: z.string(),
    imported_at: z.string(),
    status: z.enum(['complete', 'partial', 'failed']),
    fields: z.array(z.strictObject({
      id: z.string(),
      name: z.string(),
      location: z.enum(['node', 'element', 'facet', 'cell', 'global']),
      component_names: z.array(z.string()),
      unit: z.string(),
      entity_ids: z.array(z.string()),
      values: z.array(z.number().finite()),
      minimum: z.number().finite(),
      maximum: z.number().finite(),
    })),
    mesh: resultMeshSchema.optional(),
    checks: z.array(z.strictObject({
      kind: z.enum(['force_balance', 'moment_balance', 'heat_balance', 'mass_balance', 'solver_convergence', 'solver_execution']),
      status: z.enum(['pass', 'warning', 'fail', 'not_available']),
      value: z.number().finite().nullable(),
      tolerance: z.number().finite().nonnegative().nullable(),
      unit: z.string(),
      message: z.string(),
    })),
    metadata: unknownRecordSchema,
  }));

export const convergenceStudiesSchema = z.array(convergenceStudySchema);

export const validationSchema = z.strictObject({
    last_run_at: z.string(),
    model_revision: z.number().int().nonnegative(),
    validated_revision: z.number().int().min(-1),
    context: z.strictObject({
      analysis_case_id: z.string(),
      solver_target: z.enum(['OpenSeesPy', 'DOLFINx', 'OpenFOAM']),
      input_fingerprint: z.string(),
    }).optional(),
    summary: z.strictObject({
      error_count: z.number(),
      warning_count: z.number(),
      info_count: z.number(),
    }),
    items: z.array(z.strictObject({
      id: z.string(),
      severity: z.enum(['error', 'warning', 'info']),
      code: z.string(),
      title: z.string(),
      message: z.string(),
      target_ref: z.string(),
      suggested_fix: z.string(),
      dismissible: z.boolean(),
      status: z.enum(['open', 'dismissed', 'resolved']),
    })),
  });

export const uiStateSchema = z.strictObject({
    active_panel: z.string(),
    camera_state: z.strictObject({
      position: tuple3NumberSchema,
      target: tuple3NumberSchema,
      up: tuple3NumberSchema,
      zoom: z.number(),
      orthographic: z.boolean(),
    }),
    visibility_map: booleanRecordSchema,
    isolate_targets: z.array(z.string()),
    selection_state: z.array(z.string()),
    expanded_tree_nodes: z.array(z.string()),
    color_mode: z.enum(['default', 'by_material', 'by_selection', 'by_condition']),
    clipping_planes: z.array(z.strictObject({
      normal: tuple3NumberSchema,
      constant: z.number(),
      enabled: z.boolean(),
    })),
    last_opened_tabs: z.array(z.string()),
  });

export const aiAnnotationsSchema = z.array(z.strictObject({
    id: z.string(),
    source_prompt_summary: z.string(),
    target_ref: z.string(),
    proposal_type: z.enum(['naming', 'material_suggestion', 'mesh_hint', 'missing_bc_warning', 'export_gap_notice']),
    rationale: z.string(),
    confidence: z.number(),
    status: z.enum(['proposed', 'accepted', 'rejected', 'expired']),
    applied_changes: unknownRecordSchema,
  }));

export const auditTrailSchema = z.array(z.strictObject({
    id: z.string(),
    timestamp: z.string(),
    actor: z.enum(['user', 'ai', 'import', 'migration']),
    action_type: z.enum(['create', 'update', 'delete', 'assign', 'import', 'export', 'validate', 'unit_conversion', 'ai_proposal_accepted', 'ai_proposal_rejected']),
    target_ref: z.string(),
    before_summary: z.string(),
    after_summary: z.string(),
    note: z.string(),
  }));
