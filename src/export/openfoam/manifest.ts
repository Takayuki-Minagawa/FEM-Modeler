import type {
  ProjectIR
} from '@/core/ir/types';
import type { OpenFOAMExportResult } from './model';

export function makeManifest(data: Record<string, unknown>): string {
  return JSON.stringify(data, null, 2);
}

export function earlyFailure(
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
