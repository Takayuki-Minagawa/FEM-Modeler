import { transformedVolume } from './geometry';
import type { ExportContext } from './model';

export function dolfinxConservationLines(context: ExportContext): string[] {
  const lines = [
    '# Integrals and reactions below are collective: every MPI rank participates.',
    'def global_integral(expression):',
    '    return float(domain.comm.allreduce(fem.assemble_scalar(fem.form(expression)), op=MPI.SUM))',
    'result_manifest = {**result_provenance, "solver": "DOLFINx", "solver_version": dolfinx.__version__, "gmsh_version": gmsh.__version__, "python_version": platform.python_version(), "mode": "' + context.mode + '", "converged_reason": converged_reason, "iteration_count": iteration_count, "solution_min": global_minimum, "solution_max": global_maximum}',
    'owned_facets = domain.topology.index_map(domain.topology.dim - 1).size_local',
    `physical_tags = ${JSON.stringify([...new Set(context.tagBySelectionId.values())].sort((a, b) => a - b))}`,
    'result_manifest["physical_tag_counts"] = {str(tag): int(domain.comm.allreduce(np.count_nonzero(facet_tags.find(tag) < owned_facets), op=MPI.SUM)) for tag in physical_tags}',
  ];
  if (context.mode !== 'thermal') return lines;
  lines.push(
    'from dolfinx.fem.petsc import assemble_vector',
    'from petsc4py import PETSc',
    'thermal_residual = assemble_vector(fem.form(ufl.action(a, uh) - L))',
    'thermal_residual.ghostUpdate(addv=PETSc.InsertMode.ADD, mode=PETSc.ScatterMode.REVERSE)',
    'owned_dofs = V.dofmap.index_map.size_local * V.dofmap.index_map_bs',
    'heat_boundary_outward = []',
    'heat_boundary_labels = []',
    'heat_source = 0.0',
    'heat_dirichlet_counts = np.zeros(owned_dofs, dtype=np.int32)',
  );
  for (const condition of context.boundaryConditions.filter((bc) => bc.bc_type === 'temperature')) {
    const tag = context.tagBySelectionId.get(condition.target_named_selection_id)!;
    lines.push(`owned_temperature_dofs = fem.locate_dofs_topological(V, domain.topology.dim - 1, facet_tags.find(${tag}))`);
    lines.push('owned_temperature_dofs = owned_temperature_dofs[owned_temperature_dofs < owned_dofs]');
    lines.push('heat_dirichlet_counts[owned_temperature_dofs] += 1');
  }
  for (let index = 0;index < context.loads.length;index++) {
    const load = context.loads[index];
    const selection = context.ir.named_selections.find((item) => item.id === load.target_named_selection_id)!;
    if (load.load_type === 'volumetric_heat' || selection.target_dimension === 3) {
      lines.push(`heat_source += global_integral(heat_source_${index} * dx)`);
    } else {
      const tag = context.tagBySelectionId.get(selection.id)!;
      lines.push(`heat_boundary_outward.append(-global_integral(surface_heat_${index} * ds(${tag})))`);
      lines.push(`heat_boundary_labels.append(${JSON.stringify(`surface_heat:${tag}`)})`);
    }
  }
  for (let index = 0;index < context.boundaryConditions.length;index++) {
    const bc = context.boundaryConditions[index];
    const tag = context.tagBySelectionId.get(bc.target_named_selection_id)!;
    if (bc.bc_type === 'temperature') {
      lines.push(`reaction_dofs = fem.locate_dofs_topological(V, domain.topology.dim - 1, facet_tags.find(${tag}))`);
      lines.push('reaction_dofs = reaction_dofs[reaction_dofs < owned_dofs]');
      lines.push('heat_boundary_outward.append(-float(domain.comm.allreduce(float(np.sum(thermal_residual.array[reaction_dofs] / heat_dirichlet_counts[reaction_dofs])), op=MPI.SUM)))');
    } else if (bc.bc_type === 'heat_flux') {
      lines.push(`heat_boundary_outward.append(global_integral(outward_flux_${index} * ds(${tag})))`);
    } else if (bc.bc_type === 'convection') {
      lines.push(`heat_boundary_outward.append(global_integral(h_${index} * (uh - ambient_temperature_${index}) * ds(${tag})))`);
    } else {
      lines.push('heat_boundary_outward.append(0.0)');
    }
    lines.push(`heat_boundary_labels.append(${JSON.stringify(`${bc.bc_type}:${tag}`)})`);
  }
  lines.push(
    'heat_tolerance = 1e-6 * max(1.0, abs(heat_source), *(abs(value) for value in heat_boundary_outward))',
    'result_manifest.update({"heat_boundary_outward_W": heat_boundary_outward, "heat_boundary_labels": heat_boundary_labels, "heat_source_W": heat_source, "heat_balance_tolerance_W": heat_tolerance, "heat_balance_method": "variational Dirichlet reactions (shared dofs split equally) and integrated prescribed/Robin flux; positive outward"})',
    'thermal_residual.destroy()',
  );
  return lines;
}

export function dolfinxResultPackageLines(context: ExportContext): string[] {
  const thermal = context.mode === 'thermal';
  const volume = transformedVolume(context.shape, context.body);
  return [
    '# Linear Lagrange output mesh: IDs come from the distributed degree-of-freedom map.',
    'W = fem.functionspace(domain, ("Lagrange", 1))',
    'output_components = []',
    `for component in range(${thermal ? 1 : 3}):`,
    '    output_function = fem.Function(W)',
    `    output_function.interpolate(${thermal ? 'uh' : 'uh.sub(component)'})`,
    '    output_function.x.scatter_forward()',
    '    output_components.append(output_function.x.array.copy())',
    'coordinates = W.tabulate_dof_coordinates()',
    'node_map = W.dofmap.index_map',
    'node_global_ids = node_map.local_to_global(np.arange(node_map.size_local + node_map.num_ghosts, dtype=np.int32))',
    'cell_map = domain.topology.index_map(domain.topology.dim)',
    'cell_global_ids = cell_map.local_to_global(np.arange(cell_map.size_local, dtype=np.int32))',
    'local_nodes = [{"id": str(int(node_global_ids[index])), "position": coordinates[index].tolist()} for index in range(node_map.size_local)]',
    'domain.topology.create_connectivity(domain.topology.dim, domain.topology.dim - 1)',
    'cell_facets = domain.topology.connectivity(domain.topology.dim, domain.topology.dim - 1)',
    'facet_tag_lookup = dict(zip(facet_tags.indices.tolist(), facet_tags.values.tolist()))',
    'local_elements = []',
    'local_quality = []',
    'for cell in range(cell_map.size_local):',
    '    dofs = W.dofmap.cell_dofs(cell)',
    '    points = coordinates[dofs]',
    '    volume = abs(float(np.linalg.det(np.column_stack([points[axis] - points[0] for axis in (1, 2, 3)])))) / 6.0',
    '    edge_sum = sum(float(np.dot(points[j] - points[i], points[j] - points[i])) for i in range(4) for j in range(i + 1, 4))',
    '    local_quality.append(12.0 * (3.0 * volume) ** (2.0 / 3.0) / edge_sum if edge_sum > 0 else 0.0)',
    '    tags = sorted({str(facet_tag_lookup[facet]) for facet in cell_facets.links(cell) if facet in facet_tag_lookup})',
    '    local_elements.append({"id": str(int(cell_global_ids[cell])), "type": "tetra4", "node_ids": [str(int(node_global_ids[dof])) for dof in dofs], "boundary_tags": tags})',
    'local_fields = [component[:node_map.size_local].tolist() for component in output_components]',
    'parts = domain.comm.gather((local_nodes, local_elements, local_quality, local_fields), root=0)',
    'if domain.comm.rank == 0:',
    '    nodes = [node for part in parts for node in part[0]]',
    '    elements = [element for part in parts for element in part[1]]',
    '    quality = [value for part in parts for value in part[2]]',
    '    node_ids = [node["id"] for node in nodes]',
    '    components = [[value for part in parts for value in part[3][component]] for component in range(len(output_components))]',
    `    field_names = ${JSON.stringify(thermal ? ['temperature'] : ['ux_m', 'uy_m', 'uz_m'])}`,
    `    fields = [{"name": name, "location": "node", "unit": "${thermal ? 'K' : 'm'}", "entity_ids": node_ids, "values": values} for name, values in zip(field_names, components)]`,
    ...(thermal ? [] : ['    fields.append({"name": "displacement_magnitude", "location": "node", "unit": "m", "entity_ids": node_ids, "values": [sum(value * value for value in row) ** 0.5 for row in zip(*components)]})']),
    `    result_mesh = {"length_unit": "m", "nodes": nodes, "elements": elements, "source": {"solver": "DOLFINx", "generator": "Gmsh 4.15 / DOLFINx 0.10 distributed P1 map", "input_fingerprint": result_provenance["input_fingerprint"]}, "representative_size": (${volume} / len(elements)) ** (1.0 / 3.0), "quality": [{"name": "tetra_mean_ratio", "definition": "12*(3*volume)^(2/3)/sum(squared edge lengths); 1 for regular tetrahedron, 0 for degenerate", "unit": "1", "element_ids": [element["id"] for element in elements], "values": quality, "bad_below": 0.1}]}`,
    '    with open("result_package.json", "w", encoding="utf-8") as package_file:',
    '        json.dump({"format": "fem-modeler-result-package-v1", "manifest": result_manifest, "mesh": result_mesh, "fields": fields}, package_file, allow_nan=False)',
  ];
}
