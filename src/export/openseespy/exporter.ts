import type { ProjectIR } from '@/core/ir/types';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

interface Node { id: number; x: number; y: number; z: number }
interface Element { id: number; nodeI: number; nodeJ: number; sectionTag: number; transfTag: number }
interface FixCondition { nodeId: number; dofs: number[] }
interface NodalLoad { nodeId: number; pattern: number; fx: number; fy: number; fz: number }

export interface OpenSeesPyExportResult {
  success: boolean;
  script: string;
  nodesCsv: string;
  elementsCsv: string;
  manifest: string;
  errors: string[];
  warnings: string[];
}

export function exportOpenSeesPy(ir: ProjectIR): OpenSeesPyExportResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Find frame bodies
  const frameBodies = ir.geometry.bodies.filter((b) => b.category === 'beam_region');
  if (frameBodies.length === 0) {
    return { success: false, script: '', nodesCsv: '', elementsCsv: '', manifest: '', errors: ['No frame/truss geometry found.'], warnings };
  }

  const body = frameBodies[0];
  const meta = body.metadata;
  const shapeType = meta.shapeType as string;

  // Extract nodes from geometry vertices
  const vertices = ir.geometry.vertices.filter((v) => v.body_id === body.id);
  const nodes: Node[] = vertices.map((v, i) => ({ id: i + 1, x: v.position[0], y: v.position[1], z: v.position[2] }));

  // If no vertices, build from shape params
  if (nodes.length === 0) {
    if (shapeType === 'frame2d') {
      const spanX = meta.spanX as number;
      const spanY = meta.spanY as number;
      const cols = meta.columns as number;
      const floors = meta.floors as number;
      const colSpacing = spanX / Math.max(cols - 1, 1);
      const floorH = spanY / floors;
      let nid = 1;
      for (let f = 0; f <= floors; f++) {
        for (let c = 0; c < cols; c++) {
          nodes.push({ id: nid++, x: c * colSpacing, y: f * floorH, z: 0 });
        }
      }
    } else if (shapeType === 'truss2d') {
      const span = meta.span as number;
      const height = meta.height as number;
      const divs = meta.divisions as number;
      const segLen = span / divs;
      let nid = 1;
      // Bottom chord nodes
      for (let i = 0; i <= divs; i++) {
        nodes.push({ id: nid++, x: i * segLen, y: 0, z: 0 });
      }
      // Top chord nodes
      for (let i = 1; i < divs; i++) {
        const y = Math.min(i, divs - i) * (height / (divs / 2));
        if (y > 0) nodes.push({ id: nid++, x: i * segLen, y, z: 0 });
      }
    }
  }

  // Build elements
  const elements: Element[] = [];
  let eid = 1;
  if (shapeType === 'frame2d') {
    const cols = meta.columns as number;
    const floors = meta.floors as number;
    // Columns
    for (let c = 0; c < cols; c++) {
      for (let f = 0; f < floors; f++) {
        const ni = f * cols + c + 1;
        const nj = (f + 1) * cols + c + 1;
        elements.push({ id: eid++, nodeI: ni, nodeJ: nj, sectionTag: 1, transfTag: 1 });
      }
    }
    // Beams
    for (let f = 1; f <= floors; f++) {
      for (let c = 0; c < cols - 1; c++) {
        const ni = f * cols + c + 1;
        const nj = f * cols + c + 2;
        elements.push({ id: eid++, nodeI: ni, nodeJ: nj, sectionTag: 1, transfTag: 1 });
      }
    }
  } else if (shapeType === 'truss2d') {
    const divs = meta.divisions as number;
    // Bottom chord
    for (let i = 0; i < divs; i++) {
      elements.push({ id: eid++, nodeI: i + 1, nodeJ: i + 2, sectionTag: 1, transfTag: 1 });
    }
    // Additional truss elements (simplified)
    const topStart = divs + 2;
    for (let i = 0; i < divs - 1; i++) {
      if (i + topStart <= nodes.length) {
        elements.push({ id: eid++, nodeI: i + 2, nodeJ: i + topStart, sectionTag: 1, transfTag: 1 });
      }
    }
  }

  // Determine ndm/ndf
  const ndm = 2;
  const ndf = shapeType === 'truss2d' ? 2 : 3;
  const elementType = shapeType === 'truss2d' ? 'Truss' : 'elasticBeamColumn';

  // Material & section info
  const sec = ir.sections[0];
  const mat = sec ? ir.materials.find((m) => m.id === sec.material_id) : ir.materials[0];

  if (!mat) {
    errors.push('No material defined. Define a material before exporting.');
  }
  if (!sec) {
    errors.push('No section defined. Define a section before exporting.');
  }

  const E = mat?.parameter_set.young_modulus.value ?? 2.05e11;
  const A = sec?.area ?? 0.01;
  const Iz = sec?.inertia_y ?? 1e-4;

  // --- Support conditions: resolve from IR boundary conditions ---
  const fixes: FixCondition[] = [];
  const fixedNodeIds = new Set<number>();

  for (const bc of ir.boundary_conditions) {
    if (bc.physics_domain !== 'structural') continue;
    if (bc.bc_type !== 'fixed' && bc.bc_type !== 'prescribed_displacement' && bc.bc_type !== 'symmetry') continue;

    // Resolve target nodes via named selection
    const targetNodes = resolveTargetNodes(bc.target_named_selection_id, ir, nodes, body.id, 'support');

    // Build DOF fixity from dof_map or default to fully fixed
    let dofs: number[];
    if (bc.values.dof_map) {
      const dm = bc.values.dof_map;
      if (ndf === 3) {
        dofs = [dm.ux === 'free' ? 0 : 1, dm.uy === 'free' ? 0 : 1, dm.rz === 'free' ? 0 : 1];
      } else {
        dofs = [dm.ux === 'free' ? 0 : 1, dm.uy === 'free' ? 0 : 1];
      }
    } else {
      dofs = ndf === 3 ? [1, 1, 1] : [1, 1];
    }

    for (const n of targetNodes) {
      if (!fixedNodeIds.has(n.id)) {
        fixedNodeIds.add(n.id);
        fixes.push({ nodeId: n.id, dofs });
      }
    }
  }

  // No structural BCs resolved — report as error
  if (fixes.length === 0) {
    errors.push('No structural boundary conditions could be resolved. Define boundary conditions before exporting.');
    const minY = Math.min(...nodes.map((n) => n.y));
    const bottomNodes = nodes.filter((n) => n.y === minY);
    for (const n of bottomNodes) {
      fixes.push({ nodeId: n.id, dofs: ndf === 3 ? [1, 1, 1] : [1, 1] });
    }
  }

  // --- Loads: resolve from IR loads ---
  const nodalLoads: NodalLoad[] = [];

  for (const load of ir.loads) {
    if (load.physics_domain !== 'structural') continue;

    const targetNodes = resolveTargetNodes(load.target_named_selection_id, ir, nodes, body.id, 'load');
    if (targetNodes.length === 0) {
      warnings.push(`Load "${load.name}" has no resolvable target nodes.`);
      continue;
    }

    const mag = load.magnitude;
    // For 'total' mode, distribute among target nodes; otherwise per-node
    const perNode = load.application_mode === 'total' ? mag / targetNodes.length : mag;

    for (const n of targetNodes) {
      nodalLoads.push({
        nodeId: n.id,
        pattern: 1,
        fx: perNode * load.direction[0],
        fy: perNode * load.direction[1],
        fz: perNode * load.direction[2],
      });
    }
  }

  // Generate Python script
  const lines: string[] = [
    '# OpenSeesPy script generated by FEM Modeler',
    `# Project: ${ir.meta.project_name}`,
    `# Generated: ${new Date().toISOString()}`,
    `# Units: ${ir.units.system_name}`,
    '',
    'import openseespy.opensees as ops',
    '',
    'ops.wipe()',
    `ops.model("basic", "-ndm", ${ndm}, "-ndf", ${ndf})`,
    '',
    '# --- Nodes ---',
  ];

  for (const n of nodes) {
    lines.push(`ops.node(${n.id}, ${n.x}, ${n.y})`);
  }

  lines.push('', '# --- Boundary Conditions ---');
  for (const f of fixes) {
    lines.push(`ops.fix(${f.nodeId}, ${f.dofs.join(', ')})`);
  }

  lines.push('', '# --- Materials ---');
  lines.push(`ops.uniaxialMaterial("Elastic", 1, ${E})`);

  if (elementType === 'elasticBeamColumn') {
    lines.push('', '# --- Geometric Transformation ---');
    lines.push('ops.geomTransf("Linear", 1)');
    lines.push('', '# --- Elements ---');
    for (const el of elements) {
      lines.push(`ops.element("${elementType}", ${el.id}, ${el.nodeI}, ${el.nodeJ}, ${A}, ${E}, ${Iz}, ${el.transfTag})`);
    }
  } else {
    lines.push('', '# --- Elements ---');
    for (const el of elements) {
      lines.push(`ops.element("${elementType}", ${el.id}, ${el.nodeI}, ${el.nodeJ}, ${A}, 1)`);
    }
  }

  if (nodalLoads.length > 0) {
    lines.push('', '# --- Loads ---');
    lines.push('ops.timeSeries("Linear", 1)');
    lines.push('ops.pattern("Plain", 1, 1)');
    for (const l of nodalLoads) {
      if (ndf === 3) {
        lines.push(`ops.load(${l.nodeId}, ${l.fx}, ${l.fy}, 0.0)`);
      } else {
        lines.push(`ops.load(${l.nodeId}, ${l.fx}, ${l.fy})`);
      }
    }
  }

  lines.push('', '# --- Analysis ---');
  lines.push('ops.system("BandSPD")');
  lines.push('ops.numberer("RCM")');
  lines.push('ops.constraints("Plain")');
  lines.push('ops.integrator("LoadControl", 1.0)');
  lines.push('ops.algorithm("Linear")');
  lines.push('ops.analysis("Static")');
  lines.push('ops.analyze(1)');
  lines.push('', '# --- Results ---');
  lines.push('print("Analysis complete.")');
  for (const n of nodes) {
    lines.push(`print(f"Node ${n.id}: disp = {ops.nodeDisp(${n.id})}")`);
  }

  const script = lines.join('\n');

  // CSV
  const nodesCsv = ['id,x,y,z', ...nodes.map((n) => `${n.id},${n.x},${n.y},${n.z}`)].join('\n');
  const elementsCsv = ['id,nodeI,nodeJ,sectionTag', ...elements.map((e) => `${e.id},${e.nodeI},${e.nodeJ},${e.sectionTag}`)].join('\n');

  // Manifest
  const manifest = JSON.stringify({
    export_target: 'OpenSeesPy',
    export_time: new Date().toISOString(),
    source_project: ir.meta.project_name,
    schema_version: ir.meta.schema_version,
    ndm, ndf, elementType,
    node_count: nodes.length,
    element_count: elements.length,
    warnings,
    errors,
  }, null, 2);

  return { success: errors.length === 0, script, nodesCsv, elementsCsv, manifest, errors, warnings };
}

/**
 * Resolve which nodes a BC/load targets via named selection.
 * Falls back to heuristic based on role ('support' → base nodes, 'load' → top nodes).
 */
function resolveTargetNodes(
  nsId: string,
  ir: ProjectIR,
  nodes: Node[],
  bodyId: string,
  role: 'support' | 'load',
): Node[] {
  const ns = ir.named_selections.find((n) => n.id === nsId);

  if (ns) {
    // Check if named selection directly references vertices
    const nsRefs = new Set(ns.member_refs);
    const matchedVertices = ir.geometry.vertices.filter((v) => nsRefs.has(v.id) && v.body_id === bodyId);

    if (matchedVertices.length > 0) {
      // Vertex-level named selection — resolve to matching nodes
      return nodes.filter((n) =>
        matchedVertices.some((v) =>
          Math.abs(v.position[0] - n.x) < 1e-6 &&
          Math.abs(v.position[1] - n.y) < 1e-6 &&
          Math.abs(v.position[2] - n.z) < 1e-6
        ),
      );
    }

    // Body-level named selection — use name/type hints for node filtering
    const nsName = (ns.display_name || ns.name).toLowerCase();
    const isBase = /support|base|fixed|底|基礎|支点/.test(nsName);
    const isTop = /top|load|荷重|頂|上/.test(nsName);

    if (isBase) {
      const minY = Math.min(...nodes.map((n) => n.y));
      return nodes.filter((n) => n.y === minY);
    }
    if (isTop) {
      const maxY = Math.max(...nodes.map((n) => n.y));
      return nodes.filter((n) => n.y === maxY);
    }
  }

  // Fallback heuristic based on role
  if (role === 'support') {
    const minY = Math.min(...nodes.map((n) => n.y));
    return nodes.filter((n) => n.y === minY);
  } else {
    const maxY = Math.max(...nodes.map((n) => n.y));
    return nodes.filter((n) => n.y === maxY);
  }
}

export async function downloadOpenSeesPyZip(ir: ProjectIR): Promise<OpenSeesPyExportResult> {
  const result = exportOpenSeesPy(ir);
  if (!result.success && result.errors.length > 0) return result;

  const zip = new JSZip();
  zip.file('model.py', result.script);
  zip.file('nodes.csv', result.nodesCsv);
  zip.file('elements.csv', result.elementsCsv);
  zip.file('export_manifest.json', result.manifest);

  const blob = await zip.generateAsync({ type: 'blob' });
  saveAs(blob, `${ir.meta.project_name.replace(/\s+/g, '_')}_openseespy.zip`);
  return result;
}
