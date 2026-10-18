import type { ProjectIR, ResultField, ResultIR } from '@/core/ir/types';
import { resultInputStatus } from '@/core/ir/provenance';
import { serializeCsv, type ArtifactScalar } from '@/export/shared/artifact-sanitization';
import { csvCoordinatesForResult } from './csv-mapping';

type Point = [number, number, number];
export type ResultProbe = { kind: 'point'; point: Point } | { kind: 'line'; start: Point; end: Point } | { kind: 'plane'; axis: 0 | 1 | 2; offset: number };
export interface ComparisonRequest { name: string; unit: string; tolerance: number; probe: ResultProbe }
type MatchStatus = 'matched' | 'missing' | 'ambiguous' | 'overflow';
export const COMPARISON_LIMITS = { results: 4, nodes: 100_000, samples: 20_000 } as const;
interface Sample { id: string; position: Point; value: number }
interface Match { status: MatchStatus; id?: string; value?: number; difference?: number }
interface ComparisonRow extends Sample { matches: Match[] }

const finitePoint = (value: unknown): value is Point => Array.isArray(value) && value.length === 3 && value.every(item => typeof item === 'number' && Number.isFinite(item));

/** Each ResultIR represents one imported snapshot. Never infer time zero or step one. */
export function resultSnapshot(result: ResultIR) {
  const meta = result.metadata;
  return {
    ...(typeof meta.time === 'number' && Number.isFinite(meta.time) ? { time: meta.time, timeUnit: typeof meta.time_unit === 'string' ? meta.time_unit : '' } : {}),
    ...(typeof meta.step === 'number' && Number.isSafeInteger(meta.step) && meta.step >= 0 ? { step: meta.step } : {}),
  };
}

export function comparisonFields(result: ResultIR): ResultField[] {
  if (result.metadata.stage === 'mesh_only') return [];
  return result.fields.filter(field => field.location === 'node' && field.component_names.length === 1);
}

function samplesFor(result: ResultIR, request: ComparisonRequest): Sample[] {
  const fields = comparisonFields(result).filter(field => field.name === request.name && field.unit === request.unit);
  if (fields.length !== 1) throw new Error('fieldMismatch');
  const field = fields[0];
  if (!field.values.length || field.values.length > COMPARISON_LIMITS.nodes || field.values.length !== field.entity_ids.length
    || new Set(field.entity_ids).size !== field.entity_ids.length || field.values.some(value => !Number.isFinite(value))) throw new Error('invalidField');
  const csv = csvCoordinatesForResult(result);
  const nodes = result.mesh?.nodes ?? (csv?.location === 'node' ? csv.entity_ids.map((id, index) => ({ id, position: csv.positions[index] })) : undefined);
  if (!nodes?.length || nodes.length > COMPARISON_LIMITS.nodes || new Set(nodes.map(node => node.id)).size !== nodes.length
    || nodes.some(node => !finitePoint(node.position)) || (result.mesh && result.mesh.length_unit !== 'm')) throw new Error('coordinatesRequired');
  const positions = new Map(nodes.map(node => [node.id, node.position]));
  return field.entity_ids.map((id, index) => {
    const position = positions.get(id);
    if (!position) throw new Error('coordinatesRequired');
    return { id, position, value: field.values[index] };
  });
}

function probeContains(probe: ResultProbe, position: Point, tolerance: number): boolean {
  if (probe.kind === 'plane') return Math.abs(position[probe.axis] - probe.offset) <= tolerance;
  if (probe.kind === 'point') return Math.hypot(...position.map((value, axis) => value - probe.point[axis])) <= tolerance;
  const direction = probe.end.map((value, axis) => value - probe.start[axis]);
  const length = Math.hypot(...direction);
  const unit = direction.map(value => value / length);
  const relative = position.map((value, axis) => value - probe.start[axis]);
  const distance = relative.reduce((sum, value, axis) => sum + value * unit[axis], 0);
  return distance >= -tolerance && distance <= length + tolerance
    && Math.hypot(...relative.map((value, axis) => value - Math.max(0, Math.min(length, distance)) * unit[axis])) <= tolerance;
}

function spatialIndex(samples: Sample[], tolerance: number) {
  const keyParts = (point: Point) => point.map(value => {
    const part = Math.floor(value / tolerance);
    if (!Number.isSafeInteger(part) || Math.abs(part) > Number.MAX_SAFE_INTEGER - 2) throw new Error('coordinateRange');
    return part;
  });
  // A crowded bucket is conservatively ambiguous. Keeping only two samples bounds matching work.
  const buckets = new Map<string, Sample[] | null>();
  for (const sample of samples) {
    const key = keyParts(sample.position).join(',');
    const bucket = buckets.get(key);
    buckets.set(key, bucket === null || (bucket?.length ?? 0) >= 2 ? null : [...(bucket ?? []), sample]);
  }
  return (point: Point): Match => {
    const [x, y, z] = keyParts(point);
    let found: Sample | undefined;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
      const bucket = buckets.get(`${x + i},${y + j},${z + k}`);
      if (bucket === null) return { status: 'ambiguous' };
      for (const sample of bucket ?? []) {
        if (Math.hypot(...point.map((value, axis) => value - sample.position[axis])) > tolerance) continue;
        if (found) return { status: 'ambiguous' };
        found = sample;
      }
    }
    return found ? { status: 'matched', id: found.id, value: found.value } : { status: 'missing' };
  };
}

function statistics(values: number[]) {
  let minimum = Infinity, maximum = -Infinity, mean = 0, scale = 0, squared = 0;
  values.forEach((value, index) => {
    minimum = Math.min(minimum, value); maximum = Math.max(maximum, value);
    mean = mean * (index / (index + 1)) + value / (index + 1);
    const magnitude = Math.abs(value);
    if (magnitude > scale) { squared = scale ? squared * (scale / magnitude) ** 2 + 1 : 1; scale = magnitude; }
    else if (scale) squared += (magnitude / scale) ** 2;
  });
  return values.length ? { minimum, maximum, mean, rms: scale * Math.sqrt(squared / values.length) } : null;
}

export function compareResults(ir: ProjectIR, resultIds: string[], request: ComparisonRequest) {
  if (resultIds.length < 2 || resultIds.length > COMPARISON_LIMITS.results || new Set(resultIds).size !== resultIds.length) throw new Error('selectResults');
  if (!Number.isFinite(request.tolerance) || request.tolerance <= 0) throw new Error('tolerance');
  const probe = request.probe;
  if (probe.kind === 'point' ? !finitePoint(probe.point) : probe.kind === 'line'
    ? !finitePoint(probe.start) || !finitePoint(probe.end) || !Number.isFinite(Math.hypot(...probe.end.map((value, axis) => value - probe.start[axis]))) || Math.hypot(...probe.end.map((value, axis) => value - probe.start[axis])) <= request.tolerance
    : ![0, 1, 2].includes(probe.axis) || !Number.isFinite(probe.offset)) throw new Error('probe');
  const results = resultIds.map(id => {
    const result = ir.results.find(item => item.id === id);
    if (!result) throw new Error('selectResults');
    return result;
  });
  const samples = results.map(result => samplesFor(result, request));
  const baseline = samples[0].filter(sample => probeContains(probe, sample.position, request.tolerance));
  if (!baseline.length) throw new Error('emptyProbe');
  if (baseline.length > COMPARISON_LIMITS.samples) throw new Error('sampleLimit');
  const indices = samples.slice(1).map(items => spatialIndex(items, request.tolerance));
  const rows: ComparisonRow[] = baseline.map(sample => ({ ...sample, matches: indices.map(index => index(sample.position)) }));
  const summaries = samples.slice(1).map((candidate, column) => {
    const used = new Map<string, number>();
    for (const row of rows) { const match = row.matches[column]; if (match.id) used.set(match.id, (used.get(match.id) ?? 0) + 1); }
    for (const row of rows) {
      const match = row.matches[column];
      if (match.id && (used.get(match.id) ?? 0) > 1) row.matches[column] = { status: 'ambiguous' };
      else if (match.status === 'matched') {
        const difference = match.value! - row.value;
        row.matches[column] = Number.isFinite(difference) ? { ...match, difference } : { status: 'overflow' };
      }
    }
    const matches = rows.map(row => row.matches[column]);
    const matched = matches.filter(match => match.status === 'matched');
    const baselineIds = new Map(baseline.map(sample => [sample.id, sample.position]));
    const idPositionConflicts = candidate.filter(sample => baselineIds.has(sample.id)
      && Math.hypot(...sample.position.map((value, axis) => value - baselineIds.get(sample.id)![axis])) > request.tolerance).length;
    const candidateProbed = candidate.filter(sample => probeContains(probe, sample.position, request.tolerance)).length;
    return {
      total: candidate.length, candidateProbed, matched: matched.length, missing: matches.filter(match => match.status === 'missing').length,
      ambiguous: matches.filter(match => match.status === 'ambiguous').length, overflow: matches.filter(match => match.status === 'overflow').length,
      unmatchedCandidate: Math.max(0, candidateProbed - matched.length), idPositionConflicts,
      values: statistics(matched.map(match => match.value!)), differences: statistics(matched.map(match => match.difference!)),
    };
  });
  const contexts = results.map(result => ({
    id: result.id, file: result.source_file_name, caseId: result.analysis_case_id,
    caseName: ir.analysis_cases.find(item => item.id === result.analysis_case_id)?.name ?? result.analysis_case_id,
    solver: result.solver_target, inputStatus: resultInputStatus(ir, result), status: result.status,
    fingerprint: typeof result.metadata.input_fingerprint === 'string' ? result.metadata.input_fingerprint : '',
    projectId: typeof result.metadata.project_id === 'string' ? result.metadata.project_id : '',
    ...resultSnapshot(result),
  }));
  return { request, rows, summaries, contexts, baselineTotal: samples[0].length, baseline: statistics(baseline.map(sample => sample.value)) };
}

export type ResultComparison = ReturnType<typeof compareResults>;

export function comparisonCsv(comparison: ResultComparison): string {
  const records: ArtifactScalar[][] = [
    ['# FEM Modeler result comparison; coordinates in m; no interpolation'],
    ['# Scalar', comparison.request.name, 'Unit', comparison.request.unit, 'Location', 'node'],
    ['# Probe', JSON.stringify(comparison.request.probe), 'Tolerance [m]', comparison.request.tolerance],
    ['# Status', 'Comparisons retain the imported provenance; differences do not verify solver execution.'],
    ['# Result', 'File', 'Source project ID', 'Case ID', 'Case', 'Solver', 'Input status', 'Import status', 'Input fingerprint', 'Time', 'Time unit', 'Step'],
    ...comparison.contexts.map(context => [context.id, context.file, context.projectId, context.caseId, context.caseName, context.solver, context.inputStatus, context.status, context.fingerprint, context.time, context.timeUnit, context.step]),
    [],
    ['# Candidate', 'Matched', 'Missing', 'Ambiguous', 'Overflow', 'Unmatched candidate probe nodes', 'Same ID at different position', 'Difference min', 'Difference max', 'Difference mean', 'Difference RMS'],
    ...comparison.summaries.map((summary, index) => [comparison.contexts[index + 1].id, summary.matched, summary.missing, summary.ambiguous, summary.overflow, summary.unmatchedCandidate, summary.idPositionConflicts, summary.differences?.minimum, summary.differences?.maximum, summary.differences?.mean, summary.differences?.rms]),
    [],
    ['Baseline node', 'X [m]', 'Y [m]', 'Z [m]', 'Baseline value', ...comparison.contexts.slice(1).flatMap(context => [`${context.id}: status`, `${context.id}: node`, `${context.id}: value`, `${context.id}: difference (candidate - baseline)`])],
    ...comparison.rows.map(row => [row.id, ...row.position, row.value, ...row.matches.flatMap(match => [match.status, match.id, match.value, match.difference])]),
  ];
  return serializeCsv(records);
}
