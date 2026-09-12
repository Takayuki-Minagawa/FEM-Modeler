import { z } from 'zod';
import { generateId } from '@/core/ir/id-generator';
import type { ResultField } from '@/core/ir/types';

const finite = z.number().finite();
const id = z.string().min(1).max(256);
export const resultMeshSchema = z.object({
  length_unit: z.literal('m'),
  nodes: z.array(z.object({ id, position: z.tuple([finite, finite, finite]) }).strict()).min(1).max(100_000),
  elements: z.array(z.object({
    id, type: z.enum(['line2', 'triangle3', 'quad4', 'tetra4', 'hexa8']),
    node_ids: z.array(id).min(2).max(8), boundary_tags: z.array(id).max(64).default([]),
  }).strict()).max(200_000),
  source: z.object({
    solver: z.enum(['OpenSeesPy', 'DOLFINx', 'OpenFOAM']), generator: z.string().min(1).max(512),
    input_fingerprint: z.string().min(1).max(256),
  }).strict(),
  representative_size: finite.positive().optional(),
  quality: z.array(z.object({
    name: z.string().min(1), definition: z.string().min(1), unit: z.string(),
    element_ids: z.array(id).max(200_000), values: z.array(finite).max(200_000),
    bad_below: finite.optional(), bad_above: finite.optional(),
  }).strict()).max(20).default([]),
}).strict().superRefine((mesh, ctx) => {
  const nodes = new Set(mesh.nodes.map((node) => node.id));
  const elements = new Set(mesh.elements.map((element) => element.id));
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (nodes.size !== mesh.nodes.length || elements.size !== mesh.elements.length) issue('Mesh IDs must be unique.');
  const sizes = { line2: 2, triangle3: 3, quad4: 4, tetra4: 4, hexa8: 8 };
  for (const element of mesh.elements) {
    if (element.node_ids.length !== sizes[element.type] || new Set(element.node_ids).size !== element.node_ids.length
      || element.node_ids.some((nodeId) => !nodes.has(nodeId))) issue(`Invalid connectivity for element ${element.id}.`);
  }
  for (const quality of mesh.quality) {
    if (quality.element_ids.length !== quality.values.length || new Set(quality.element_ids).size !== quality.element_ids.length
      || quality.element_ids.some((elementId) => !elements.has(elementId))) issue(`Invalid quality values for ${quality.name}.`);
    if (quality.bad_below !== undefined && quality.bad_above !== undefined && quality.bad_below > quality.bad_above) issue('Quality thresholds must be ordered.');
  }
});
export type ResultMesh = z.infer<typeof resultMeshSchema>;

const packageFieldSchema = z.object({
  name: z.string().min(1), location: z.enum(['node', 'element', 'cell']), unit: z.string(),
  entity_ids: z.array(id).max(200_000), values: z.array(finite).max(200_000),
}).strict();
export const resultPackageSchema = z.object({
  format: z.literal('fem-modeler-result-package-v1'),
  manifest: z.record(z.string(), z.unknown()),
  mesh: resultMeshSchema,
  fields: z.array(packageFieldSchema).max(256).default([]),
}).strict();

/** Shared by standalone packages and persisted projects; loading must not bypass mesh ownership checks. */
export function validateMeshFieldReferences(mesh: ResultMesh, fields: Array<Pick<ResultField, 'name' | 'location' | 'unit' | 'entity_ids' | 'values'>>) {
  const nodeIds = new Set(mesh.nodes.map((node) => node.id));
  const elementIds = new Set(mesh.elements.map((element) => element.id));
  const signatures = new Set<string>();
  for (const field of fields) {
    const name = /^u[xyz]_m$/.test(field.name) && field.unit === 'm' ? field.name.slice(0, -2) : field.name;
    const signature = JSON.stringify([name, field.location, field.unit]);
    if (signatures.has(signature)) throw new Error(`Duplicate scalar field: ${name}.`);
    signatures.add(signature);
    if (!['node', 'element', 'cell'].includes(field.location)) throw new Error(`Unsupported mesh field location: ${field.location}.`);
    const ids = field.location === 'node' ? nodeIds : elementIds;
    if (field.entity_ids.length !== field.values.length || field.values.length === 0
      || new Set(field.entity_ids).size !== field.entity_ids.length || field.entity_ids.some((entityId) => !ids.has(entityId))) {
      throw new Error(`Field ${field.name} contains invalid or duplicate mesh entity IDs.`);
    }
  }
}

/** Parse explicit solver IDs; never reconstruct node correspondence from array order. */
export function parseResultPackage(value: unknown): { mesh: ResultMesh; fields: ResultField[]; manifest: Record<string, unknown> } {
  const parsed = resultPackageSchema.parse(value);
  if (parsed.manifest.export_target !== parsed.mesh.source.solver
    || parsed.manifest.input_fingerprint !== parsed.mesh.source.input_fingerprint) {
    throw new Error('Mesh and result manifest provenance do not match.');
  }
  validateMeshFieldReferences(parsed.mesh, parsed.fields);
  const fields = parsed.fields.map((field) => {
    const name = /^u[xyz]_m$/.test(field.name) && field.unit === 'm' ? field.name.slice(0, -2) : field.name;
    let minimum = Infinity, maximum = -Infinity;
    for (const v of field.values) { minimum = Math.min(minimum, v); maximum = Math.max(maximum, v); }
    return { ...field, name, id: generateId('result_field'), component_names: [name], minimum, maximum };
  });
  return { mesh: parsed.mesh, fields, manifest: parsed.manifest };
}

export function summarizeMesh(mesh: ResultMesh) {
  const tags: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const element of mesh.elements) for (const tag of new Set(element.boundary_tags)) tags[tag] = (tags[tag] ?? 0) + 1;
  const bad = new Set<string>();
  const quality = mesh.quality.map((metric) => {
    let minimum = Infinity, maximum = -Infinity;
    let count = 0;
    const bins = [0, 0, 0, 0, 0];
    for (const value of metric.values) { minimum = Math.min(minimum, value); maximum = Math.max(maximum, value); }
    metric.values.forEach((value, index) => {
      bins[maximum === minimum ? 0 : Math.min(4, Math.floor(5 * (value - minimum) / (maximum - minimum)))] += 1;
      if ((metric.bad_below !== undefined && value < metric.bad_below) || (metric.bad_above !== undefined && value > metric.bad_above)) {
        bad.add(metric.element_ids[index]); count += 1;
      }
    });
    return { ...metric, minimum: metric.values.length ? minimum : null, maximum: metric.values.length ? maximum : null, badCount: count, bins };
  });
  return { nodeCount: mesh.nodes.length, elementCount: mesh.elements.length, tags, quality, badElementIds: [...bad] };
}
