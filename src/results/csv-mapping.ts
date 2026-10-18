import { parseDecimalNumber } from '@/core/numeric';
import { generateId } from '@/core/ir/id-generator';
import type { ResultField, ResultIR, ResultLocation, SolverTargetName } from '@/core/ir/types';
import type { CsvExclusionReason, ResultImportDiagnostic } from './import-diagnostics';
import { extractCsvProvenance, fieldNameAndUnit, locationFromHeader, parseCsv } from './csv-source';

export interface ResultCsvMapping {
  entityColumn: number | null;
  location: ResultLocation;
  coordinates: { x: number | null; y: number | null; z: number | null; unit: string };
  fields: Array<{ column: number; enabled: boolean; name: string; unit: string }>;
  missingPolicy: 'exclude_columns' | 'exclude_rows' | 'reject';
}
export interface ResultCsvPreview {
  headers: string[];
  sample: Array<{ sourceLine: number; values: string[] }>;
  sourceRows: number;
  importedRows: number;
  excludedRows: number;
  excludedColumns: string[];
  ignoredColumns: string[];
  importedFields: number;
  affectedRows: number;
  diagnostics: ResultImportDiagnostic[];
  error?: string;
  mapping: ResultCsvMapping;
}

/** Known source units normalize to SI. Unknown labels are retained verbatim and explicitly warned about. */
const units: Record<string, [string, number, number?]> = {
  '': ['', 1], '1': ['1', 1], m: ['m', 1], mm: ['m', 1e-3], cm: ['m', 1e-2], 'µm': ['m', 1e-6], um: ['m', 1e-6],
  in: ['m', 0.0254], ft: ['m', 0.3048], N: ['N', 1], kN: ['N', 1000], Pa: ['Pa', 1], kPa: ['Pa', 1000], MPa: ['Pa', 1e6], GPa: ['Pa', 1e9],
  K: ['K', 1], '°C': ['K', 1, 273.15], degC: ['K', 1, 273.15], rad: ['rad', 1], deg: ['rad', Math.PI / 180],
  'N·m': ['N·m', 1], Nm: ['N·m', 1], 'N·mm': ['N·m', 1e-3], 'm/s': ['m/s', 1], 'mm/s': ['m/s', 1e-3],
  'kg/s': ['kg/s', 1], s: ['s', 1], ms: ['s', 1e-3], W: ['W', 1], kW: ['W', 1000], J: ['J', 1], 'm²': ['m²', 1],
};
export function csvUnitConversion(unit: string) {
  const normalized = unit.trim();
  const known = Object.hasOwn(units, normalized) ? units[normalized] : undefined;
  return { unit: known?.[0] ?? normalized, factor: known?.[1] ?? 1, offset: known?.[2] ?? 0, recognized: Boolean(known) };
}

function csvDocument(text: string) {
  const provenance = extractCsvProvenance(text.replace(/^\uFEFF/, ''));
  const { records, sourceLines } = parseCsv(provenance.csv, provenance.firstSourceLine);
  if (records.length < 2) throw new Error('Result CSV requires a header and at least one data row.');
  const headers = records[0].map((header) => header.trim());
  const rows = records.slice(1);
  if (headers.some((header) => !header)) throw new Error('Result CSV headers must not be empty.');
  if (new Set(headers).size !== headers.length) throw new Error('Result CSV headers must be unique.');
  if (rows.some((row) => row.length !== headers.length)) throw new Error('Result CSV rows do not have a consistent column count.');
  return { headers, rows, sourceLines: sourceLines.slice(1), metadata: provenance.metadata };
}
type CsvDocument = ReturnType<typeof csvDocument>;

class CsvMappingError extends Error {
  diagnostics: ResultImportDiagnostic[];
  affectedRows: number;
  constructor(message: string, diagnostics: ResultImportDiagnostic[], affectedRows: number) {
    super(message); this.diagnostics = diagnostics; this.affectedRows = affectedRows;
  }
}

function defaultMapping(headers: string[], solver: SolverTargetName): ResultCsvMapping {
  const index = headers.findIndex((header) => /(?:^|_)(id|tag)$/i.test(header) || /^(node|element|cell|facet)/i.test(header));
  return {
    entityColumn: index < 0 ? null : index,
    location: index < 0 ? 'global' : locationFromHeader(headers[index], solver),
    coordinates: { x: null, y: null, z: null, unit: 'm' },
    fields: headers.map((header, column) => ({ column, enabled: column !== index, ...fieldNameAndUnit(header) })),
    missingPolicy: 'exclude_columns',
  };
}

function mapDocument(document: CsvDocument, mapping: ResultCsvMapping) {
  const { headers, rows, sourceLines } = document;
  const validColumn = (column: number | null) => column === null || (Number.isInteger(column) && column >= 0 && column < headers.length);
  if (!validColumn(mapping.entityColumn) || mapping.fields.some((field) => !validColumn(field.column))
    || !['node', 'element', 'facet', 'cell', 'global'].includes(mapping.location)
    || !['exclude_columns', 'exclude_rows', 'reject'].includes(mapping.missingPolicy)) throw new Error('Invalid CSV column mapping.');
  const coordinates = mapping.coordinates;
  const coordinateColumns = [coordinates.x, coordinates.y, coordinates.z].filter((column): column is number => column !== null);
  if (coordinateColumns.some((column) => !validColumn(column)) || new Set(coordinateColumns).size !== coordinateColumns.length
    || coordinateColumns.includes(mapping.entityColumn as number)) throw new Error('Coordinate columns must be distinct from each other and the ID column.');
  if (coordinateColumns.length > 0 && (coordinates.x === null || coordinates.y === null)) throw new Error('Select both X and Y coordinates; Z may be omitted for 2D data.');
  const coordinateUnit = csvUnitConversion(coordinates.unit);
  if (coordinateColumns.length > 0 && (!coordinateUnit.recognized || coordinateUnit.unit !== 'm')) throw new Error('Coordinate units must be a supported length unit (m, mm, cm, µm, in, ft).');
  const reserved = new Set([mapping.entityColumn, ...coordinateColumns]);
  const selected = mapping.fields.filter((field) => field.enabled && !reserved.has(field.column));
  if (selected.length === 0) throw new Error('Select at least one numeric field column.');
  if (new Set(selected.map((field) => field.column)).size !== selected.length || selected.some((field) => !field.name.trim())
    || new Set(selected.map((field) => field.name.trim())).size !== selected.length) throw new Error('Selected numeric field names and columns must be unique and non-empty.');
  const selectedColumns = new Set(selected.map((field) => field.column));
  const ignoredColumns = headers.filter((_, index) => !reserved.has(index) && !selectedColumns.has(index));
  const diagnostics: ResultImportDiagnostic[] = [];
  const invalidRows = new Set<number>();
  const invalidColumns = new Set<number>();
  const valuesByColumn = new Map<number, number[]>();
  const invalid = (message: string) => new CsvMappingError(message, diagnostics, invalidRows.size);
  for (const column of [...selectedColumns, ...coordinateColumns]) {
    const rawValues = rows.map((row) => row[column].trim());
    const values = rawValues.map((raw) => parseDecimalNumber(raw) ?? (/^[+-]?Infinity$/.test(raw) ? Number(raw) : NaN));
    valuesByColumn.set(column, values);
    const exclusions: Record<CsvExclusionReason, number[]> = { missing_value: [], nonnumeric_value: [], nonfinite_value: [] };
    rawValues.forEach((value, row) => {
      const reason = value.length === 0 ? 'missing_value' : Number.isNaN(values[row]) ? 'nonnumeric_value' : !Number.isFinite(values[row]) ? 'nonfinite_value' : undefined;
      if (reason) { exclusions[reason].push(sourceLines[row]); invalidRows.add(row); invalidColumns.add(column); }
    });
    for (const reason of Object.keys(exclusions) as CsvExclusionReason[]) {
      if (exclusions[reason].length === 0) continue;
      const description = { missing_value: 'missing values', nonnumeric_value: 'nonnumeric values', nonfinite_value: 'non-finite values' }[reason];
      const excludedColumn = mapping.missingPolicy === 'exclude_columns';
      const lines = exclusions[reason];
      const lineLabel = `${lines.slice(0, 30).join(', ')}${lines.length > 30 ? ` … (${lines.length} total)` : ''}`;
      diagnostics.push({
        code: excludedColumn ? 'excluded_column' : 'excluded_rows', column: headers[column], column_index: column + 1,
        source_rows: lines, reason,
        message: excludedColumn
          ? `Excluded CSV column "${headers[column]}" (${column + 1}): ${description} on source line(s) ${lineLabel}. The entire column was excluded; other columns retain these rows.`
          : `CSV column "${headers[column]}" (${column + 1}): ${description} on source line(s) ${lineLabel}. ${mapping.missingPolicy === 'reject' ? 'Import is rejected until these values are corrected or an exclusion policy is selected.' : 'These rows are excluded from all selected fields and coordinates.'}`,
      });
    }
  }
  if (invalidRows.size && mapping.missingPolicy === 'reject') throw invalid(`CSV contains invalid values on ${invalidRows.size} source row(s). Choose an exclusion policy or correct the source file.`);
  if (mapping.missingPolicy === 'exclude_columns' && coordinateColumns.some((column) => invalidColumns.has(column))) throw invalid('A coordinate column contains invalid values. Exclude affected rows or correct the source file.');
  const rowIndexes = rows.map((_, index) => index).filter((index) => mapping.missingPolicy !== 'exclude_rows' || !invalidRows.has(index));
  if (rowIndexes.length === 0) throw invalid('No data rows remain after exclusions.');
  const entityIds = rowIndexes.map((index) => mapping.entityColumn === null ? String(index + 1) : rows[index][mapping.entityColumn].trim());
  if (entityIds.some((id) => id.length === 0)) throw new Error('Result CSV entity IDs must not be empty.');
  if (new Set(entityIds).size !== entityIds.length) throw new Error('Result CSV entity IDs must be unique.');
  const fields: ResultField[] = [];
  const excludedColumns: string[] = [];
  const sourceUnits: Array<{ column: string; source_unit: string; stored_unit: string; conversion: string }> = [];
  for (const field of selected) {
    if (mapping.missingPolicy === 'exclude_columns' && invalidColumns.has(field.column)) { excludedColumns.push(headers[field.column]); continue; }
    const conversion = csvUnitConversion(field.unit);
    const values = rowIndexes.map((row) => valuesByColumn.get(field.column)![row] * conversion.factor + conversion.offset);
    if (values.some((value) => !Number.isFinite(value))) throw new Error(`Unit conversion overflow in column "${headers[field.column]}".`);
    if (!conversion.recognized) diagnostics.push({ code: 'unconverted_unit', column: headers[field.column], message: `Unit "${field.unit}" for "${field.name}" is an unrecognized label. Values were preserved without conversion and must not be assumed to be SI.` });
    sourceUnits.push({ column: headers[field.column], source_unit: field.unit, stored_unit: conversion.unit, conversion: conversion.recognized ? 'recognized_to_si' : 'label_only' });
    let minimum = Infinity, maximum = -Infinity;
    for (const value of values) { minimum = Math.min(minimum, value); maximum = Math.max(maximum, value); }
    fields.push({ id: generateId('result_field'), name: field.name.trim(), location: mapping.location, component_names: [field.name.trim()], unit: conversion.unit, entity_ids: entityIds, values, minimum, maximum });
  }
  if (fields.length === 0) throw invalid('Result CSV has no finite numeric field columns.');
  const positions = coordinateColumns.length ? rowIndexes.map((row) => [coordinates.x, coordinates.y, coordinates.z].map((column) => column === null ? 0 : valuesByColumn.get(column)![row] * coordinateUnit.factor)) : undefined;
  if (positions?.some((position) => position.some((value) => !Number.isFinite(value)))) throw new Error('Coordinate conversion overflows the finite numeric range.');
  return { fields, diagnostics, excludedColumns, ignoredColumns, sourceUnits, rowIndexes, positions, entityIds, affectedRows: invalidRows.size };
}

export function previewResultCsv(text: string, solver: SolverTargetName, requestedMapping?: ResultCsvMapping): ResultCsvPreview {
  const document = csvDocument(text);
  const mapping = requestedMapping ?? defaultMapping(document.headers, solver);
  const base = { headers: document.headers, sample: document.rows.slice(0, 8).map((values, index) => ({ sourceLine: document.sourceLines[index], values: values.map((value) => value.length > 160 ? `${value.slice(0, 160)}…` : value) })), sourceRows: document.rows.length, mapping };
  try {
    const mapped = mapDocument(document, mapping);
    return { ...base, importedRows: mapped.rowIndexes.length, excludedRows: document.rows.length - mapped.rowIndexes.length, excludedColumns: mapped.excludedColumns, ignoredColumns: mapped.ignoredColumns, importedFields: mapped.fields.length, affectedRows: mapped.affectedRows, diagnostics: mapped.diagnostics };
  } catch (error) {
    return { ...base, importedRows: 0, excludedRows: 0, excludedColumns: [], ignoredColumns: [], importedFields: 0, affectedRows: error instanceof CsvMappingError ? error.affectedRows : 0, diagnostics: error instanceof CsvMappingError ? error.diagnostics : [], error: error instanceof Error ? error.message : String(error) };
  }
}

export function importMappedCsv(text: string, sourceFileName: string, analysisCaseId: string, solver: SolverTargetName, requestedMapping?: ResultCsvMapping): ResultIR {
  const document = csvDocument(text);
  const mapping = requestedMapping ?? defaultMapping(document.headers, solver);
  const mapped = mapDocument(document, mapping);
  const metadata = { ...document.metadata };
  delete metadata.import_warnings; delete metadata.import_outcome; delete metadata.csv_coordinates;
  return {
    id: generateId('result'), analysis_case_id: analysisCaseId, solver_target: solver, source_file_name: sourceFileName,
    imported_at: new Date().toISOString(), status: mapped.diagnostics.some((item) => item.code === 'excluded_column' || item.code === 'excluded_rows') ? 'partial' : 'complete',
    fields: mapped.fields, checks: [],
    metadata: { ...metadata, format: 'csv', row_count: document.rows.length, imported_row_count: mapped.rowIndexes.length,
      skipped_columns: mapped.excludedColumns, ignored_columns: mapped.ignoredColumns, csv_mapping: mapping,
      source_units: mapped.sourceUnits, import_diagnostics: mapped.diagnostics,
      ...(mapped.positions ? { csv_coordinates: { unit: 'm', location: mapping.location, entity_ids: mapped.entityIds, positions: mapped.positions } } : {}),
    },
  };
}

export interface ResultCsvCoordinates {
  unit: 'm';
  location: ResultLocation;
  entity_ids: string[];
  positions: [number, number, number][];
}

/** Saved metadata is untrusted; comparison/probing must validate correspondence before using coordinates. */
export function csvCoordinatesForResult(result: ResultIR): ResultCsvCoordinates | undefined {
  const value = result.metadata.csv_coordinates;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const coordinates = value as Record<string, unknown>;
  if (coordinates.unit !== 'm' || !['node', 'element', 'facet', 'cell', 'global'].includes(String(coordinates.location))
    || !Array.isArray(coordinates.entity_ids) || !Array.isArray(coordinates.positions)
    || coordinates.entity_ids.length === 0 || coordinates.entity_ids.length > 100_000
    || coordinates.entity_ids.length !== coordinates.positions.length
    || coordinates.entity_ids.some((id) => typeof id !== 'string' || !id.trim())
    || new Set(coordinates.entity_ids).size !== coordinates.entity_ids.length
    || coordinates.positions.some((position) => !Array.isArray(position) || position.length !== 3 || position.some((v) => typeof v !== 'number' || !Number.isFinite(v)))) return undefined;
  return coordinates as unknown as ResultCsvCoordinates;
}
