import { generateId } from '@/core/ir/id-generator';
import type {
  ConservationCheck,
  ResultField,
  ResultIR,
  ResultLocation,
  SolverProfileHint,
  SolverTargetName,
} from '@/core/ir/types';

export const MAX_RESULT_TEXT_BYTES = 20 * 1024 * 1024;
export const MAX_RESULT_CSV_ROWS = 100_000;
export const MAX_RESULT_CSV_COLUMNS = 256;
export const MAX_RESULT_CSV_CELLS = 1_000_000;
const MAX_CONSERVATION_COMPONENTS = 16;
const CSV_PROVENANCE_PREFIX = '# FEM_MODELER_PROVENANCE ';

export interface ResultImportResponse {
  success: boolean;
  result?: ResultIR;
  error?: string;
  warnings: string[];
}

export interface ResultImportExpectations {
  expectedModelRevision?: number;
}

export function solverTargetForProfile(profile: SolverProfileHint): SolverTargetName {
  if (profile.startsWith('openseespy_')) return 'OpenSeesPy';
  if (profile.startsWith('dolfinx_')) return 'DOLFINx';
  return 'OpenFOAM';
}

function declaredResultTarget(metadata: Record<string, unknown>): SolverTargetName | undefined {
  const declared = metadata.export_target;
  if (declared === undefined) return undefined;
  if (declared === 'OpenSeesPy' || declared === 'DOLFINx' || declared === 'OpenFOAM') return declared;
  throw new Error(`Result manifest declares unsupported export_target "${String(declared)}".`);
}

function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  let cellCount = 0;
  const appendRecord = () => {
    if (!record.some((value) => value.length > 0)) return;
    if (record.length > MAX_RESULT_CSV_COLUMNS) {
      throw new Error(`Result CSV exceeds the ${MAX_RESULT_CSV_COLUMNS}-column safety limit.`);
    }
    if (records.length >= MAX_RESULT_CSV_ROWS + 1) {
      throw new Error(`Result CSV exceeds the ${MAX_RESULT_CSV_ROWS}-row safety limit.`);
    }
    cellCount += record.length;
    if (cellCount > MAX_RESULT_CSV_CELLS) {
      throw new Error(`Result CSV exceeds the ${MAX_RESULT_CSV_CELLS}-cell safety limit.`);
    }
    records.push(record);
  };
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"' && field.length === 0) quoted = true;
    else if (character === ',') {
      record.push(field);
      field = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      record.push(field);
      appendRecord();
      record = [];
      field = '';
    } else field += character;
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field.');
  record.push(field);
  appendRecord();
  return records;
}

function locationFromHeader(header: string, solverTarget: SolverTargetName): ResultLocation {
  const normalized = header.toLowerCase();
  if (normalized.includes('node')) return 'node';
  if (normalized.includes('element')) return 'element';
  if (normalized.includes('facet') || normalized.includes('face')) return 'facet';
  if (normalized.includes('cell')) return 'cell';
  return solverTarget === 'OpenFOAM' ? 'cell' : 'node';
}

function fieldNameAndUnit(header: string): { name: string; unit: string } {
  const bracket = /^(.*?)\s*\[([^\]]+)]$/.exec(header.trim());
  if (bracket) return { name: bracket[1].trim(), unit: bracket[2].trim() };
  const suffixes: Array<[RegExp, string]> = [
    [/_m$/i, 'm'], [/_rad$/i, 'rad'], [/_n$/i, 'N'], [/_nm$/i, 'N·m'],
    [/_pa$/i, 'Pa'], [/_k$/i, 'K'], [/_m_s$/i, 'm/s'], [/_kg_s$/i, 'kg/s'],
  ];
  for (const [pattern, unit] of suffixes) if (pattern.test(header)) return { name: header.replace(pattern, ''), unit };
  return { name: header.trim(), unit: '' };
}

function extractCsvProvenance(text: string): { csv: string; metadata: Record<string, unknown> } {
  const firstBreak = text.search(/[\r\n]/);
  const firstLine = (firstBreak < 0 ? text : text.slice(0, firstBreak)).trim();
  if (!firstLine.startsWith(CSV_PROVENANCE_PREFIX)) return { csv: text, metadata: {} };
  const raw = firstLine.slice(CSV_PROVENANCE_PREFIX.length);
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('CSV provenance header must contain a JSON object.');
  }
  const remainderStart = firstBreak < 0
    ? text.length
    : text[firstBreak] === '\r' && text[firstBreak + 1] === '\n' ? firstBreak + 2 : firstBreak + 1;
  return { csv: text.slice(remainderStart), metadata: parsed as Record<string, unknown> };
}

function importCsv(text: string, sourceFileName: string, analysisCaseId: string, solverTarget: SolverTargetName): ResultIR {
  const provenance = extractCsvProvenance(text);
  const records = parseCsv(provenance.csv);
  if (records.length < 2) throw new Error('Result CSV requires a header and at least one data row.');
  const headers = records[0].map((header) => header.trim());
  const rows = records.slice(1);
  if (headers.some((header) => header.length === 0)) throw new Error('Result CSV headers must not be empty.');
  if (new Set(headers).size !== headers.length) throw new Error('Result CSV headers must be unique.');
  if (rows.some((row) => row.length !== headers.length)) throw new Error('Result CSV rows do not have a consistent column count.');
  const entityColumn = headers.findIndex((header) => /(?:^|_)(id|tag)$/i.test(header) || /^(node|element|cell|facet)/i.test(header));
  const entityIds = rows.map((row, index) => entityColumn >= 0 ? row[entityColumn].trim() : String(index + 1));
  if (entityIds.some((id) => id.length === 0)) throw new Error('Result CSV entity IDs must not be empty.');
  if (new Set(entityIds).size !== entityIds.length) throw new Error('Result CSV entity IDs must be unique.');
  const location = entityColumn >= 0 ? locationFromHeader(headers[entityColumn], solverTarget) : 'global';
  const fields: ResultField[] = [];
  const skippedColumns: string[] = [];
  for (let column = 0; column < headers.length; column += 1) {
    if (column === entityColumn) continue;
    const rawValues = rows.map((row) => row[column].trim());
    if (rawValues.some((value) => value.length === 0)) {
      skippedColumns.push(headers[column]);
      continue;
    }
    const values = rawValues.map(Number);
    if (!values.every(Number.isFinite)) {
      skippedColumns.push(headers[column]);
      continue;
    }
    const descriptor = fieldNameAndUnit(headers[column]);
    let minimum = values[0];
    let maximum = values[0];
    for (const value of values.slice(1)) {
      if (value < minimum) minimum = value;
      if (value > maximum) maximum = value;
    }
    fields.push({
      id: generateId('result_field'),
      name: descriptor.name,
      location,
      component_names: [descriptor.name],
      unit: descriptor.unit,
      entity_ids: entityIds,
      values,
      minimum,
      maximum,
    });
  }
  if (fields.length === 0) throw new Error('Result CSV has no finite numeric field columns.');
  return {
    id: generateId('result'),
    analysis_case_id: analysisCaseId,
    solver_target: solverTarget,
    source_file_name: sourceFileName,
    imported_at: new Date().toISOString(),
    status: 'complete',
    fields,
    checks: [],
    metadata: { ...provenance.metadata, row_count: rows.length, format: 'csv', skipped_columns: skippedColumns },
  };
}

function finiteConservationVector(value: unknown): number[] | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)
      || value.length === 0
      || value.length > MAX_CONSERVATION_COMPONENTS
      || !value.every((item) => typeof item === 'number' && Number.isFinite(item))) {
    throw new Error(`force_imbalance_N must be a non-empty finite vector with at most ${MAX_CONSERVATION_COMPONENTS} components.`);
  }
  return value;
}

function checksFromManifest(manifest: Record<string, unknown>): ConservationCheck[] {
  const checks: ConservationCheck[] = [];
  const imbalance = finiteConservationVector(manifest.force_imbalance_N);
  const rawTolerance = manifest.balance_tolerance_N;
  if (rawTolerance !== undefined
      && (typeof rawTolerance !== 'number' || !Number.isFinite(rawTolerance) || rawTolerance < 0)) {
    throw new Error('balance_tolerance_N must be a finite, non-negative number.');
  }
  const tolerance = typeof rawTolerance === 'number' ? rawTolerance : null;
  if (imbalance) {
    let value = 0;
    for (const component of imbalance) value = Math.max(value, Math.abs(component));
    const status = tolerance === null ? 'warning' : value <= tolerance ? 'pass' : 'fail';
    checks.push({
      kind: 'force_balance',
      status,
      value,
      tolerance,
      unit: 'N',
      message: tolerance === null
        ? `Maximum force imbalance is ${value} N; no finite tolerance was declared.`
        : `Maximum force imbalance is ${value} N (recomputed against tolerance ${tolerance} N).`,
    });
  }
  const convergedReason = manifest.converged_reason;
  const returnCode = manifest.analysis_return_code;
  if (typeof convergedReason === 'number' || typeof returnCode === 'number') {
    const value = typeof convergedReason === 'number' ? convergedReason : returnCode as number;
    const pass = typeof convergedReason === 'number' ? convergedReason > 0 : returnCode === 0;
    checks.push({
      kind: 'solver_convergence',
      status: pass ? 'pass' : 'fail',
      value,
      tolerance: null,
      unit: '',
      message: pass ? 'Solver reported successful convergence.' : 'Solver reported failure.',
    });
  }
  const executionReturnCode = manifest.execution_return_code;
  if (typeof executionReturnCode === 'number' && Number.isFinite(executionReturnCode)) {
    checks.push({
      kind: 'solver_execution',
      status: executionReturnCode === 0 ? 'pass' : 'fail',
      value: executionReturnCode,
      tolerance: 0,
      unit: '',
      message: executionReturnCode === 0
        ? 'Solver process exited successfully; numerical convergence was not inferred.'
        : 'Solver process reported a non-zero exit code.',
    });
  }
  return checks;
}

function importManifest(text: string, sourceFileName: string, analysisCaseId: string, solverTarget: SolverTargetName): ResultIR {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Result manifest root must be an object.');
  const metadata = parsed as Record<string, unknown>;
  const checks = checksFromManifest(metadata);
  if (checks.length === 0) throw new Error('JSON does not contain a supported result or conservation manifest.');
  return {
    id: generateId('result'),
    analysis_case_id: analysisCaseId,
    solver_target: solverTarget,
    source_file_name: sourceFileName,
    imported_at: new Date().toISOString(),
    status: checks.some((check) => check.status === 'fail') ? 'failed' : 'partial',
    fields: [],
    checks,
    metadata,
  };
}

export function importResultText(
  text: string,
  sourceFileName: string,
  analysisCaseId: string,
  solverTarget: SolverTargetName,
  expectations: ResultImportExpectations = {},
): ResultImportResponse {
  const warnings: string[] = [];
  try {
    if (!analysisCaseId) throw new Error('Select an analysis case before importing results.');
    if (new TextEncoder().encode(text).byteLength > MAX_RESULT_TEXT_BYTES) throw new Error('Result file exceeds the 20 MB text import limit.');
    const isManifest = sourceFileName.toLowerCase().endsWith('.json');
    const result = isManifest
      ? importManifest(text, sourceFileName, analysisCaseId, solverTarget)
      : importCsv(text, sourceFileName, analysisCaseId, solverTarget);
    const sourceLabel = isManifest ? 'manifest' : 'CSV';
    const declaredTarget = declaredResultTarget(result.metadata);
    if (declaredTarget && declaredTarget !== solverTarget) {
      throw new Error(`Result ${sourceLabel} was produced by ${declaredTarget}, but the selected analysis case uses ${solverTarget}.`);
    }
    if (!declaredTarget) {
      warnings.push(`The ${sourceLabel} does not declare export_target; solver provenance could not be verified.`);
    }
    const declaredCaseId = result.metadata.analysis_case_id;
    if (typeof declaredCaseId === 'string' && declaredCaseId !== analysisCaseId) {
      throw new Error(`Result ${sourceLabel} belongs to analysis case "${declaredCaseId}", not selected case "${analysisCaseId}".`);
    }
    if (declaredCaseId === undefined || declaredCaseId === null) {
      warnings.push(`The ${sourceLabel} does not declare analysis_case_id; case provenance could not be verified.`);
    }
    const declaredRevision = result.metadata.model_revision;
    if (expectations.expectedModelRevision !== undefined
      && typeof declaredRevision === 'number'
      && declaredRevision !== expectations.expectedModelRevision) {
      throw new Error(`Result ${sourceLabel} model revision ${declaredRevision} does not match current revision ${expectations.expectedModelRevision}.`);
    }
    if (expectations.expectedModelRevision !== undefined && typeof declaredRevision !== 'number') {
      warnings.push(`The ${sourceLabel} does not declare model_revision; model provenance could not be verified.`);
    }

    const provenanceVerified = declaredTarget === solverTarget
      && declaredCaseId === analysisCaseId
      && expectations.expectedModelRevision !== undefined
      && declaredRevision === expectations.expectedModelRevision;
    result.metadata.provenance_verified = provenanceVerified;
    if (provenanceVerified) {
      result.metadata.imported_for_model_revision = expectations.expectedModelRevision;
    } else if (result.status === 'complete') {
      result.status = 'partial';
    }
    const skippedColumns = result.metadata.skipped_columns;
    if (Array.isArray(skippedColumns) && skippedColumns.length > 0) {
      warnings.push(`Skipped nonnumeric CSV column(s): ${skippedColumns.join(', ')}.`);
      if (result.status === 'complete') result.status = 'partial';
    }
    if (result.fields.length === 0) warnings.push('The manifest contains checks only; import a result CSV to visualize fields.');
    return { success: true, result, warnings };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error), warnings };
  }
}
