import type { ResultIR } from '@/core/ir/types';

export type ResultImportOutcome = 'success' | 'partial' | 'warning';
export type ResultSolverStatus = 'not_run' | 'not_reported' | 'converged' | 'execution_succeeded' | 'failed' | 'warning';
export type ResultImportDiagnosticCode =
  | 'missing_solver' | 'missing_case' | 'missing_revision' | 'unverified_identity'
  | 'mesh_variant' | 'checks_only' | 'excluded_column' | 'excluded_rows' | 'unconverted_unit';
export type CsvExclusionReason = 'missing_value' | 'nonnumeric_value' | 'nonfinite_value';

/** Source line numbers are one-based, including the CSV header and provenance line. */
export interface ResultImportDiagnostic {
  code: ResultImportDiagnosticCode;
  message: string;
  column?: string;
  column_index?: number;
  source_rows?: number[];
  reason?: CsvExclusionReason;
}

const codes: ResultImportDiagnosticCode[] = ['missing_solver', 'missing_case', 'missing_revision', 'unverified_identity', 'mesh_variant', 'checks_only', 'excluded_column', 'excluded_rows', 'unconverted_unit'];
const reasons: CsvExclusionReason[] = ['missing_value', 'nonnumeric_value', 'nonfinite_value'];

/** Metadata is also read from older saved projects; never assume its shape. */
export function resultImportDiagnostics(result: ResultIR): ResultImportDiagnostic[] {
  const value = result.metadata.import_diagnostics;
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ResultImportDiagnostic => {
    if (typeof item !== 'object' || item === null || !codes.includes(item.code) || typeof item.message !== 'string') return false;
    if (item.code !== 'excluded_column' && item.code !== 'excluded_rows') return true;
    return typeof item.column === 'string' && Number.isSafeInteger(item.column_index) && item.column_index > 0
      && reasons.includes(item.reason) && Array.isArray(item.source_rows)
      && item.source_rows.every((row: unknown) => typeof row === 'number' && Number.isSafeInteger(row) && row > 0);
  });
}

export function resultImportWarnings(result: ResultIR): string[] {
  const warnings = result.metadata.import_warnings;
  return Array.isArray(warnings) ? warnings.filter((warning): warning is string => typeof warning === 'string') : [];
}

export function resultImportOutcome(result: ResultIR): ResultImportOutcome {
  const outcome = result.metadata.import_outcome;
  if (outcome === 'success' || outcome === 'partial' || outcome === 'warning') return outcome;
  if (result.status === 'partial' || resultImportDiagnostics(result).some((item) => item.code === 'excluded_column' || item.code === 'excluded_rows')) return 'partial';
  return resultImportWarnings(result).length > 0 ? 'warning' : 'success';
}

export function isMeshOnlyResult(result: ResultIR): boolean {
  return Boolean(result.mesh) && result.metadata.stage === 'mesh_only' && result.fields.length === 0 && result.checks.length === 0;
}

/** A parsed field is not evidence that the solver ran or numerically converged. */
export function resultSolverStatus(result: ResultIR): ResultSolverStatus {
  if (result.metadata.stage === 'mesh_only') return 'not_run';
  const checks = result.checks.filter((check) => check.kind === 'solver_execution' || check.kind === 'solver_convergence');
  if (checks.some((check) => check.status === 'fail')) return 'failed';
  if (checks.some((check) => check.status !== 'pass')) return 'warning';
  if (checks.some((check) => check.kind === 'solver_convergence')) return 'converged';
  return checks.length > 0 ? 'execution_succeeded' : 'not_reported';
}
