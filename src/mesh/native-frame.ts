import type { ProjectIR, ResultIR } from '@/core/ir/types';
import { createExportProvenance } from '@/core/ir/provenance';
import { generateId } from '@/core/ir/id-generator';
import { scopeProjectForAnalysisCaseValidation } from '@/export/compiler/capabilities';
import { applyTransformToPoint } from '@/geometry/transforms';
import { resultMeshSchema } from '@/results/package';
import { solverTargetForProfile } from '@/results/importer';

/** Actual native graph connectivity, with no subdivision, node welding or solver execution. */
export function generateNativeFrameMesh(ir: ProjectIR, analysisCaseId: string): ResultIR {
  const analysisCase = ir.analysis_cases.find((item) => item.id === analysisCaseId);
  if (!analysisCase || !['frame', 'truss'].includes(analysisCase.domain_type) || solverTargetForProfile(analysisCase.solver_profile_hint) !== 'OpenSeesPy') {
    throw new Error('Native graph meshing requires an OpenSeesPy frame or truss analysis case.');
  }
  const scoped = scopeProjectForAnalysisCaseValidation(ir, analysisCaseId);
  if (!scoped.geometry.bodies.length || scoped.geometry.bodies.some((body) => body.asset_ref || !['frame2d', 'truss2d'].includes(String(body.metadata.shapeType)))) {
    throw new Error('Native graph meshing supports frame2d and truss2d bodies only. Imported CAD and continuum meshing require an external mesher.');
  }
  if (!scoped.geometry.edges.length) throw new Error('The selected case has no native graph edges to mesh.');
  if (scoped.geometry.vertices.length > 100_000 || scoped.geometry.edges.length > 200_000) throw new Error('Native graph exceeds mesh safety limits.');
  const bodies = new Map(scoped.geometry.bodies.map((body) => [body.id, body]));
  const vertices = new Map(scoped.geometry.vertices.map((vertex) => [vertex.id, vertex]));
  const used = new Set(scoped.geometry.edges.flatMap((edge) => edge.vertex_ids));
  const nodes = scoped.geometry.vertices.filter((vertex) => used.has(vertex.id)).map((vertex) => {
    const owner = bodies.get(vertex.body_id);
    if (!owner) throw new Error(`Missing owner for vertex ${vertex.id}.`);
    const position = applyTransformToPoint(vertex.position, owner.transform);
    if (!position.every(Number.isFinite)) throw new Error('Mesh coordinates exceed the finite SI range.');
    return { id: vertex.id, position };
  });
  const points = new Map(nodes.map((node) => [node.id, node.position]));
  const lengths: number[] = [];
  const selections = scoped.named_selections.filter((selection) => selection.status === 'active').map((selection) => ({ ...selection, members: new Set(selection.member_refs) }));
  const elements = scoped.geometry.edges.map((edge) => {
    const owner = bodies.get(edge.body_id);
    if (!owner || edge.vertex_ids.some((id) => vertices.get(id)?.body_id !== owner.id || !points.has(id))) throw new Error(`Invalid native graph connectivity for ${edge.id}.`);
    const [a, b] = edge.vertex_ids.map((id) => points.get(id)!);
    const length = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    if (!Number.isFinite(length)) throw new Error('Mesh element length exceeds the finite SI range.');
    lengths.push(length);
    const boundary_tags = selections.filter((selection) => selection.entity_type === 'body' ? selection.members.has(edge.body_id)
      : selection.entity_type === 'edge' ? selection.members.has(edge.id)
        : selection.entity_type === 'vertex' && edge.vertex_ids.some((id) => selection.members.has(id))).map((selection) => selection.id);
    return { id: edge.id, type: 'line2' as const, node_ids: [...edge.vertex_ids], boundary_tags };
  });
  const provenance = createExportProvenance(ir, 'OpenSeesPy', analysisCaseId);
  const positiveLengths = lengths.filter((value) => value > 0).sort((a, b) => a - b);
  const mesh = resultMeshSchema.parse({
    length_unit: 'm', nodes, elements,
    source: { solver: 'OpenSeesPy', generator: 'FEM-Modeler native graph topology', input_fingerprint: provenance.input_fingerprint },
    ...(positiveLengths.length ? { representative_size: positiveLengths[Math.floor(positiveLengths.length / 2)] } : {}),
    quality: [{ name: 'element_length', definition: 'Euclidean endpoint distance in world SI coordinates. Zero-length line elements are bad; no continuum Jacobian/aspect ratio is inferred.', unit: 'm', element_ids: elements.map((element) => element.id), values: lengths, bad_below: Number.MIN_VALUE }],
  });
  return {
    id: generateId('result'), analysis_case_id: analysisCaseId, solver_target: 'OpenSeesPy',
    source_file_name: `${analysisCase.name}_native_mesh.json`, imported_at: new Date().toISOString(), status: 'partial',
    fields: [], checks: [], mesh,
    metadata: { ...provenance, stage: 'mesh_only', origin: 'native_frame_mesh', solver_status: 'not_run', provenance_verified: true, input_match: 'current', import_outcome: 'success', import_warnings: [], import_diagnostics: [],
      mesh_settings_applied: false, boundary_tag_semantics: 'Active case-referenced body/edge selections tag their elements; vertex selections tag incident elements. Tags are selection IDs.',
      topology_policy: 'One line2 per native edge, one node per referenced native vertex. No subdivisions or coordinate-based welding.' },
  };
}
