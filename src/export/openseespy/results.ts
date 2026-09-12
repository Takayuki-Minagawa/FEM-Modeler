import type { ExportProvenance } from '@/core/ir/provenance';
import type { OpenSeesPyModel } from './model';

/** Global equilibrium uses moments about the global origin, including nodal couples. */
export function openSeesMomentLines(model: OpenSeesPyModel): string[] {
  const appliedMoment = model.nodalLoads.reduce((sum, load) => {
    const node = model.nodes.find((candidate) => candidate.id === load.nodeId)!;
    return sum + node.x * load.fy - node.y * load.fx;
  }, 0);
  const lever = Math.max(1, ...model.nodes.map((node) => Math.hypot(node.x, node.y)));
  return [
    `applied_moment = [0.0, 0.0, ${appliedMoment}]`,
    `reaction_moment = [0.0, 0.0, sum(ops.nodeCoord(node)[0] * ops.nodeReaction(node)[1] - ops.nodeCoord(node)[1] * ops.nodeReaction(node)[0]${model.ndf === 3 ? ' + ops.nodeReaction(node)[2]' : ''} for node in ${JSON.stringify(model.nodes.map((node) => node.id))})]`,
    'moment_imbalance = [applied_moment[axis] + reaction_moment[axis] for axis in range(3)]',
    `moment_tolerance = balance_tolerance * ${lever}`,
    'if max(abs(value) for value in moment_imbalance) > moment_tolerance:',
    '    balance_status = "fail"',
  ];
}

export function openSeesResultPackageLines(model: OpenSeesPyModel, provenance: ExportProvenance): string[] {
  const mesh = {
    length_unit: 'm',
    nodes: model.nodes.map((node) => ({ id: String(node.id), position: [node.x, node.y, node.z] })),
    elements: model.elements.map((element) => ({ id: String(element.id), type: 'line2', node_ids: [String(element.nodeI), String(element.nodeJ)] })),
    source: { solver: 'OpenSeesPy', generator: 'FEM Modeler compiled node/member graph', input_fingerprint: provenance.input_fingerprint },
    quality: [],
    representative_size: model.elements.reduce((sum, element) => {
      const left = model.nodes.find((node) => node.id === element.nodeI)!;
      const right = model.nodes.find((node) => node.id === element.nodeJ)!;
      return sum + Math.hypot(right.x - left.x, right.y - left.y);
    }, 0) / model.elements.length,
  };
  return [
    `result_mesh = json.loads(${JSON.stringify(JSON.stringify(mesh))})`,
    `node_ids = ${JSON.stringify(model.nodes.map((node) => String(node.id)))}`,
    'result_fields = []',
    'for component, name in enumerate(["ux_m", "uy_m"]):',
    '    result_fields.append({"name": name, "location": "node", "unit": "m", "entity_ids": node_ids, "values": [ops.nodeDisp(int(node))[component] for node in node_ids]})',
    'result_fields.append({"name": "displacement_magnitude", "location": "node", "unit": "m", "entity_ids": node_ids, "values": [sum(value * value for value in ops.nodeDisp(int(node))[:2]) ** 0.5 for node in node_ids]})',
    'with open("result_package.json", "w", encoding="utf-8") as package_file:',
    '    json.dump({"format": "fem-modeler-result-package-v1", "manifest": result_manifest, "mesh": result_mesh, "fields": result_fields}, package_file, allow_nan=False)',
  ];
}
