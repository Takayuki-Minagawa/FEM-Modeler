import type { ResultLocation, SolverTargetName } from '@/core/ir/types';

export const MAX_RESULT_CSV_ROWS = 100_000;
export const MAX_RESULT_CSV_COLUMNS = 256;
export const MAX_RESULT_CSV_CELLS = 1_000_000;
const CSV_PROVENANCE_PREFIX = '# FEM_MODELER_PROVENANCE ';

export function parseCsv(text: string, firstSourceLine: number): { records: string[][]; sourceLines: number[] } {
  const records: string[][] = [];
  const sourceLines: number[] = [];
  let sourceLine = firstSourceLine;
  let recordStartLine = firstSourceLine;
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
    sourceLines.push(recordStartLine);
  };
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else {
        field += character;
        if (character === '\n' || (character === '\r' && text[index + 1] !== '\n')) sourceLine += 1;
      }
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
      sourceLine += 1;
      recordStartLine = sourceLine;
    } else field += character;
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field.');
  record.push(field);
  appendRecord();
  return { records, sourceLines };
}

export function locationFromHeader(header: string, solverTarget: SolverTargetName): ResultLocation {
  const normalized = header.toLowerCase();
  if (normalized.includes('node')) return 'node';
  if (normalized.includes('element')) return 'element';
  if (normalized.includes('facet') || normalized.includes('face')) return 'facet';
  if (normalized.includes('cell')) return 'cell';
  return solverTarget === 'OpenFOAM' ? 'cell' : 'node';
}

export function fieldNameAndUnit(header: string): { name: string; unit: string } {
  const bracket = /^(.*?)\s*\[([^\]]+)]$/.exec(header.trim());
  if (bracket) return { name: bracket[1].trim(), unit: bracket[2].trim() };
  const suffixes: Array<[RegExp, string]> = [
    [/_m$/i, 'm'], [/_rad$/i, 'rad'], [/_n$/i, 'N'], [/_nm$/i, 'N·m'],
    [/_pa$/i, 'Pa'], [/_k$/i, 'K'], [/_m_s$/i, 'm/s'], [/_kg_s$/i, 'kg/s'],
  ];
  for (const [pattern, unit] of suffixes) if (pattern.test(header)) return { name: header.replace(pattern, ''), unit };
  return { name: header.trim(), unit: '' };
}

export function extractCsvProvenance(text: string): { csv: string; metadata: Record<string, unknown>; firstSourceLine: number } {
  const firstBreak = text.search(/[\r\n]/);
  const firstLine = (firstBreak < 0 ? text : text.slice(0, firstBreak)).trim();
  if (!firstLine.startsWith(CSV_PROVENANCE_PREFIX)) return { csv: text, metadata: {}, firstSourceLine: 1 };
  const raw = firstLine.slice(CSV_PROVENANCE_PREFIX.length);
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('CSV provenance header must contain a JSON object.');
  }
  const remainderStart = firstBreak < 0
    ? text.length
    : text[firstBreak] === '\r' && text[firstBreak + 1] === '\n' ? firstBreak + 2 : firstBreak + 1;
  return { csv: text.slice(remainderStart), metadata: parsed as Record<string, unknown>, firstSourceLine: 2 };
}
