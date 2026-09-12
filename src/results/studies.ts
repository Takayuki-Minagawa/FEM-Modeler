import { z } from 'zod';
import type { ResultIR } from '@/core/ir/types';
import { generateId } from '@/core/ir/id-generator';
import { analyzeThreeMeshConvergence } from './convergence';

export const convergenceStudySchema = z.object({
  id: z.string().min(1), name: z.string().min(1), created_at: z.string(), analysis_case_id: z.string().min(1),
  qoi_definition: z.string().min(1), evaluation_location: z.string().min(1), unit: z.string(),
  provenance: z.enum(['verified_results', 'manual_unverified']),
  comparison_fingerprint: z.string().optional(), notes: z.string(),
  samples: z.array(z.object({
    meshSize: z.number().finite().positive(), qoi: z.number().finite(),
    elementCount: z.number().int().positive().optional(), result_id: z.string().optional(),
    input_fingerprint: z.string().optional(), run_id: z.string().optional(),
  }).strict()).length(3),
}).strict();
export type ConvergenceStudy = z.infer<typeof convergenceStudySchema>;
export interface StudyQoI {
  fieldName: string;
  unit: string;
  reduction: 'point' | 'minimum' | 'maximum';
  position?: [number, number, number];
}

export function studyFromResults(results: ResultIR[], qoi: StudyQoI): ConvergenceStudy {
  if (results.length !== 3 || new Set(results.map((result) => result.id)).size !== 3) throw new Error('Select three distinct results.');
  const reference = results[0];
  const comparison = reference.metadata.comparison_fingerprint;
  const referenceField = reference.fields.find((field) => field.name === qoi.fieldName && field.unit === qoi.unit);
  if (typeof reference.metadata.project_id !== 'string' || !reference.metadata.project_id || !referenceField) throw new Error('Project identity and the selected QoI are required.');
  if (typeof comparison !== 'string' || !comparison) throw new Error('A mesh-independent comparison fingerprint is required.');
  for (const result of results) {
    if (result.metadata.provenance_verified !== true || result.status === 'failed'
      || result.metadata.project_id !== reference.metadata.project_id
      || result.solver_target !== reference.solver_target || result.analysis_case_id !== reference.analysis_case_id
      || result.metadata.comparison_fingerprint !== comparison) {
      throw new Error('Results must have verified provenance and identical geometry, materials, conditions, case, and solver settings apart from the mesh.');
    }
  }
  const samples = results.map((result) => {
    const meshSize = result.mesh?.representative_size ?? result.metadata.representative_mesh_size;
    if (typeof meshSize !== 'number' || !Number.isFinite(meshSize) || meshSize <= 0) throw new Error('Each result must declare a positive representative mesh size in metres.');
    const fields = result.fields.filter((field) => field.name === qoi.fieldName && field.unit === qoi.unit && field.component_names.length === 1);
    if (fields.length !== 1) throw new Error('Each result must contain the same unambiguous scalar field and unit.');
    const field = fields[0];
    if (field.location !== referenceField.location) throw new Error('QoI field locations must match.');
    let value: number;
    if (qoi.reduction === 'point') {
      const position = qoi.position;
      if (!position || position.some((v) => !Number.isFinite(v)) || field.location !== 'node' || !result.mesh) throw new Error('Point comparison requires nodal fields and explicit mesh coordinates.');
      const tolerance = Math.max(1, ...position.map(Math.abs)) * 1e-9;
      const nodes = result.mesh.nodes.filter((node) => node.position.every((v, axis) => Math.abs(v - position[axis]) <= tolerance));
      if (nodes.length !== 1) throw new Error('The same evaluation point must exist uniquely in every mesh; no interpolation is assumed.');
      const index = field.entity_ids.indexOf(nodes[0].id);
      if (index < 0) throw new Error('A result is missing the field value at the requested evaluation point.');
      value = field.values[index];
    } else {
      if (!field.values.length) throw new Error('The selected field has no values.');
      if (!result.mesh) throw new Error('Global extrema comparison requires a mesh to verify field coverage.');
      const dimensions = { line2: 1, triangle3: 2, quad4: 2, tetra4: 3, hexa8: 3 };
      const dimension = result.mesh.elements.reduce((max, element) => Math.max(max, dimensions[element.type]), 0);
      const expectedIds = field.location === 'node' ? result.mesh.nodes.map((node) => node.id) : result.mesh.elements.filter((element) => dimensions[element.type] === dimension).map((element) => element.id);
      const coveredIds = new Set(field.entity_ids);
      if (expectedIds.length === 0 || expectedIds.some((id) => !coveredIds.has(id))) throw new Error('Global extrema require complete field coverage of the mesh.');
      value = field.values.reduce((acc, v) => qoi.reduction === 'minimum' ? Math.min(acc, v) : Math.max(acc, v), field.values[0]);
    }
    return {
      meshSize, qoi: value, ...(result.mesh?.elements.length ? { elementCount: result.mesh.elements.length } : {}),
      result_id: result.id,
      ...(typeof result.metadata.input_fingerprint === 'string' ? { input_fingerprint: result.metadata.input_fingerprint } : {}),
      ...(typeof result.metadata.run_id === 'string' ? { run_id: result.metadata.run_id } : {}),
    };
  }).sort((a, b) => b.meshSize - a.meshSize);
  // Mesh element counts may include boundary facets; require refinement of h,
  // and keep counts informational when mixed packages do not all supply them.
  if (samples.some((sample) => sample.elementCount === undefined)) samples.forEach((sample) => { delete sample.elementCount; });
  analyzeThreeMeshConvergence(samples);
  return convergenceStudySchema.parse({
    id: generateId('study'), name: `${qoi.fieldName} convergence`, created_at: new Date().toISOString(),
    analysis_case_id: reference.analysis_case_id, qoi_definition: qoi.fieldName,
    evaluation_location: qoi.reduction === 'point' ? `point (${qoi.position!.join(', ')}) m` : `global ${qoi.reduction}`,
    unit: qoi.unit, provenance: 'verified_results', comparison_fingerprint: comparison, notes: '', samples,
  });
}

const escapeCell = (text: string) => text.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
export function convergenceStudyMarkdown(study: ConvergenceStudy): string {
  const analysis = analyzeThreeMeshConvergence(study.samples);
  return [
    `# ${escapeCell(study.name)}`, '',
    `QoI: ${escapeCell(study.qoi_definition)} [${escapeCell(study.unit)}]`,
    `Evaluation: ${escapeCell(study.evaluation_location)}`, `Case: ${study.analysis_case_id}`,
    `Provenance: ${study.provenance}`, `Comparison fingerprint: ${study.comparison_fingerprint ?? 'not verified'}`,
    `Created: ${study.created_at}`, '',
    '| Mesh | h [m] | QoI | Elements | Result / run |', '|---|---:|---:|---:|---|',
    ...study.samples.map((sample, index) => `| ${['Coarse', 'Medium', 'Fine'][index]} | ${sample.meshSize} | ${sample.qoi} | ${sample.elementCount ?? '—'} | ${escapeCell(sample.result_id ?? 'manual')} / ${escapeCell(sample.run_id ?? '—')} |`), '',
    `Observed order p: ${analysis.observedOrder}`, `Richardson extrapolated QoI: ${analysis.richardsonExtrapolatedQoi} ${study.unit}`,
    `Fine GCI (absolute): ${analysis.gci.fineAbsolute} ${study.unit}`, `Fine GCI (%): ${analysis.gci.finePercent ?? 'undefined near zero'}`,
    `Safety factor: ${analysis.gci.safetyFactor}`, `Asymptotic ratio: ${analysis.gci.asymptoticRatio} (${analysis.regime})`, '',
    'The three-grid fit is a discretization-error estimate. Matching the fitted asymptotic ratio alone does not establish physical accuracy.',
    study.provenance === 'manual_unverified' ? 'Manual samples: input compatibility and evaluation location have not been independently verified.' : '',
    study.notes, '',
  ].join('\n');
}
