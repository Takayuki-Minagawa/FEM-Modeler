import { generateId } from '@/core/ir/id-generator';
import type {
  AnalysisCase,
  BoundaryCondition,
  DomainType,
  GeometryFace,
  GeometryVertex,
  Load,
  NamedSelection,
  NamedSelectionUsage,
  ProjectIR,
  ResultRequest,
  Section,
  SolverProfileHint,
  SolverTargetName,
} from '@/core/ir/types';
import { generateShape } from '@/geometry/primitives/generators';
import type { GeneratedTopology } from '@/geometry/primitives/types';
import { useAppStore } from '@/state/store';
import { createMaterialFromLibrary, MATERIAL_LIBRARY } from './material-library';

const POSITION_TOLERANCE = 1e-9;

/**
 * Populate the newly created project with a complete, solver-ready benchmark.
 * The entire template is applied through one public store transaction so one
 * Undo operation removes the whole template.
 */
export function applyTemplate(domain: DomainType, lang: string): void {
  if (domain === 'coupled') return;
  const store = useAppStore.getState();
  const label = lang === 'ja' ? `${domain}テンプレートを適用` : `Apply ${domain} template`;

  store.mutateIR(label, (ir) => {
    switch (domain) {
      case 'frame':
        applyFrameTemplate(ir, lang);
        break;
      case 'truss':
        applyTrussTemplate(ir, lang);
        break;
      case 'solid':
        applySolidTemplate(ir, lang);
        break;
      case 'thermal':
        applyThermalTemplate(ir, lang);
        break;
      case 'fluid':
        applyFluidTemplate(ir, lang);
        break;
      default:
        return;
    }
  });
}

function applyFrameTemplate(ir: ProjectIR, lang: string): void {
  const shape = generateShape(
    { shapeType: 'frame2d', spanX: 6, spanY: 9, columns: 3, floors: 3 },
    lang === 'ja' ? '2Dフレーム' : '2D Frame',
  );
  addTopology(ir, shape, 'frame_graph');

  const material = createMaterialFromLibrary(MATERIAL_LIBRARY[0], lang);
  const section: Section = {
    id: generateId('section'),
    name: lang === 'ja' ? 'H形断面' : 'H-Section',
    section_type: 'beam_h',
    dimensions: { width: 0.2, height: 0.4 },
    material_id: material.id,
    area: 0.008,
    inertia_y: 2.0e-4,
    inertia_z: 1.0e-4,
    torsion_constant: 5.0e-6,
    thickness: null,
    metadata: { effective_length_factor: 1 },
  };

  const minimumY = Math.min(...shape.vertices.map((vertex) => vertex.position[1]));
  const maximumY = Math.max(...shape.vertices.map((vertex) => vertex.position[1]));
  const baseVertices = verticesAtY(shape.vertices, minimumY);
  const topVertices = verticesAtY(shape.vertices, maximumY);
  const memberSelection = createSelection({
    name: 'frame_members',
    displayName: lang === 'ja' ? '全フレーム部材' : 'All Frame Members',
    dimension: 1,
    entityType: 'edge',
    memberRefs: shape.edges.map((edge) => edge.id),
    color: '#607d8b',
    usages: ['material_assignment', 'section_assignment', 'export_tag'],
  });
  const supportSelection = createSelection({
    name: 'support_base',
    displayName: lang === 'ja' ? '基礎支点' : 'Base Supports',
    dimension: 0,
    entityType: 'vertex',
    memberRefs: baseVertices.map((vertex) => vertex.id),
    color: '#e53935',
    usages: ['boundary_condition', 'export_tag'],
  });
  const loadSelection = createSelection({
    name: 'lateral_load_top',
    displayName: lang === 'ja' ? '最上階節点' : 'Top Floor Nodes',
    dimension: 0,
    entityType: 'vertex',
    memberRefs: topVertices.map((vertex) => vertex.id),
    color: '#ff9800',
    usages: ['load', 'export_tag'],
  });

  const support: BoundaryCondition = {
    id: generateId('boundary_condition'),
    name: 'fixed_support',
    physics_domain: 'structural',
    bc_type: 'fixed',
    target_named_selection_id: supportSelection.id,
    coordinate_system: 'global',
    values: {
      dof_map: {
        ux: 'fixed', uy: 'fixed', uz: 'free',
        rx: 'free', ry: 'free', rz: 'fixed',
      },
    },
    temporal_profile: 'constant',
    status: 'confirmed',
    notes: '',
  };
  const load: Load = {
    id: generateId('load'),
    name: lang === 'ja' ? '最上階水平荷重' : 'Top Floor Lateral Load',
    physics_domain: 'structural',
    load_type: 'nodal_force',
    target_named_selection_id: loadSelection.id,
    application_mode: 'total',
    direction: [1, 0, 0],
    magnitude: 10_000,
    distribution: 'uniform',
    temporal_profile: 'constant',
    load_case: 'default',
    coordinate_system: 'global',
    status: 'confirmed',
  };

  ir.materials.push(material);
  ir.sections.push(section);
  ir.named_selections.push(memberSelection, supportSelection, loadSelection);
  ir.material_assignments.push({
    id: generateId('material_assignment'),
    material_id: material.id,
    target_named_selection_id: memberSelection.id,
    override_allowed: false,
  });
  ir.section_assignments.push({
    id: generateId('section_assignment'),
    section_id: section.id,
    target_named_selection_id: memberSelection.id,
  });
  ir.boundary_conditions.push(support);
  ir.loads.push(load);
  addAnalysisCase(ir, {
    domain: 'frame',
    type: 'static_linear',
    hint: 'openseespy_frame_basic',
    lang,
    materials: [material.id],
    sections: [section.id],
    boundaryConditions: [support.id],
    loads: [load.id],
    results: ['displacement', 'reaction_force'],
  });
  configureSolver(ir, 'OpenSeesPy');
}

function applyTrussTemplate(ir: ProjectIR, lang: string): void {
  const shape = generateShape(
    { shapeType: 'truss2d', span: 10, height: 2, divisions: 6 },
    lang === 'ja' ? '2Dトラス' : '2D Truss',
  );
  addTopology(ir, shape, 'frame_graph');

  const material = createMaterialFromLibrary(MATERIAL_LIBRARY[0], lang);
  const diameter = 0.05;
  const section: Section = {
    id: generateId('section'),
    name: lang === 'ja' ? '丸鋼断面' : 'Round Bar',
    section_type: 'beam_circle',
    dimensions: { diameter },
    material_id: material.id,
    area: Math.PI * (diameter / 2) ** 2,
    inertia_y: null,
    inertia_z: null,
    torsion_constant: null,
    thickness: null,
    metadata: { effective_length_factor: 1 },
  };

  const bottomVertices = shape.vertices.filter(
    (vertex) => Math.abs(vertex.position[1]) <= POSITION_TOLERANCE,
  );
  const leftSupportVertex = extremeVertex(bottomVertices, 0, 'min');
  const rightSupportVertex = extremeVertex(bottomVertices, 0, 'max');
  const topLoadVertex = extremeVertex(shape.vertices, 1, 'max');
  const memberSelection = createSelection({
    name: 'truss_members',
    displayName: lang === 'ja' ? '全トラス部材' : 'All Truss Members',
    dimension: 1,
    entityType: 'edge',
    memberRefs: shape.edges.map((edge) => edge.id),
    color: '#607d8b',
    usages: ['material_assignment', 'section_assignment', 'export_tag'],
  });
  const leftSupportSelection = createSelection({
    name: 'left_pin',
    displayName: lang === 'ja' ? '左ピン支点' : 'Left Pin Support',
    dimension: 0,
    entityType: 'vertex',
    memberRefs: [leftSupportVertex.id],
    color: '#e53935',
    usages: ['boundary_condition', 'export_tag'],
  });
  const rightSupportSelection = createSelection({
    name: 'right_roller',
    displayName: lang === 'ja' ? '右ローラー支点' : 'Right Roller Support',
    dimension: 0,
    entityType: 'vertex',
    memberRefs: [rightSupportVertex.id],
    color: '#d32f2f',
    usages: ['boundary_condition', 'export_tag'],
  });
  const loadSelection = createSelection({
    name: 'top_load_node',
    displayName: lang === 'ja' ? '頂部荷重点' : 'Top Load Node',
    dimension: 0,
    entityType: 'vertex',
    memberRefs: [topLoadVertex.id],
    color: '#ff9800',
    usages: ['load', 'export_tag'],
  });

  const leftSupport = structuralSupport('left_pin_support', leftSupportSelection.id, {
    ux: 'fixed', uy: 'fixed', uz: 'free', rx: 'free', ry: 'free', rz: 'free',
  });
  const rightSupport = structuralSupport('right_roller_support', rightSupportSelection.id, {
    ux: 'free', uy: 'fixed', uz: 'free', rx: 'free', ry: 'free', rz: 'free',
  });
  const topLoad: Load = {
    id: generateId('load'),
    name: lang === 'ja' ? '頂部鉛直荷重' : 'Top Vertical Load',
    physics_domain: 'structural',
    load_type: 'nodal_force',
    target_named_selection_id: loadSelection.id,
    application_mode: 'total',
    direction: [0, -1, 0],
    magnitude: 50_000,
    distribution: 'uniform',
    temporal_profile: 'constant',
    load_case: 'default',
    coordinate_system: 'global',
    status: 'confirmed',
  };

  ir.materials.push(material);
  ir.sections.push(section);
  ir.named_selections.push(
    memberSelection,
    leftSupportSelection,
    rightSupportSelection,
    loadSelection,
  );
  ir.material_assignments.push({
    id: generateId('material_assignment'),
    material_id: material.id,
    target_named_selection_id: memberSelection.id,
    override_allowed: false,
  });
  ir.section_assignments.push({
    id: generateId('section_assignment'),
    section_id: section.id,
    target_named_selection_id: memberSelection.id,
  });
  ir.boundary_conditions.push(leftSupport, rightSupport);
  ir.loads.push(topLoad);
  addAnalysisCase(ir, {
    domain: 'truss',
    type: 'static_linear',
    hint: 'openseespy_frame_basic',
    lang,
    materials: [material.id],
    sections: [section.id],
    boundaryConditions: [leftSupport.id, rightSupport.id],
    loads: [topLoad.id],
    results: ['displacement', 'reaction_force'],
  });
  configureSolver(ir, 'OpenSeesPy');
}

function applySolidTemplate(ir: ProjectIR, lang: string): void {
  const shape = generateShape(
    { shapeType: 'plateWithHole', width: 4, depth: 2, thickness: 0.2, holeRadius: 0.3 },
    lang === 'ja' ? '穴あき平板' : 'Plate with Hole',
  );
  addTopology(ir, shape, 'cad_brep');

  const material = createMaterialFromLibrary(MATERIAL_LIBRARY[0], lang);
  const bodySelection = bodySelectionFor(shape, 'solid_domain', lang === 'ja' ? 'ソリッド領域' : 'Solid Domain');
  const fixedFace = requireFace(shape.faces, 'bottom');
  const loadedFace = requireFace(shape.faces, 'top');
  const fixedSelection = faceSelection(
    'fixed_face',
    lang === 'ja' ? '固定面' : 'Fixed Face',
    [fixedFace],
    '#e53935',
    ['boundary_condition', 'export_tag'],
  );
  const loadedSelection = faceSelection(
    'pressure_face',
    lang === 'ja' ? '圧力面' : 'Pressure Face',
    [loadedFace],
    '#ff9800',
    ['load', 'export_tag'],
  );
  const fixedSupport = structuralSupport('fixed_face_support', fixedSelection.id, {
    ux: 'fixed', uy: 'fixed', uz: 'fixed', rx: 'free', ry: 'free', rz: 'free',
  });
  const pressure: Load = {
    id: generateId('load'),
    name: lang === 'ja' ? '面圧' : 'Surface Pressure',
    physics_domain: 'structural',
    load_type: 'pressure',
    target_named_selection_id: loadedSelection.id,
    application_mode: 'per_area',
    direction: [0, -1, 0],
    magnitude: 1.0e6,
    distribution: 'uniform',
    temporal_profile: 'constant',
    load_case: 'default',
    coordinate_system: 'global',
    status: 'confirmed',
  };

  ir.materials.push(material);
  ir.named_selections.push(bodySelection, fixedSelection, loadedSelection);
  ir.material_assignments.push({
    id: generateId('material_assignment'),
    material_id: material.id,
    target_named_selection_id: bodySelection.id,
    override_allowed: false,
  });
  ir.boundary_conditions.push(fixedSupport);
  ir.loads.push(pressure);
  ir.mesh_controls.global.global_size = 0.08;
  addAnalysisCase(ir, {
    domain: 'solid',
    type: 'static_linear',
    hint: 'dolfinx_linear_elasticity',
    lang,
    materials: [material.id],
    boundaryConditions: [fixedSupport.id],
    loads: [pressure.id],
    results: ['displacement'],
  });
  configureSolver(ir, 'DOLFINx');
}

function applyThermalTemplate(ir: ProjectIR, lang: string): void {
  const shape = generateShape(
    { shapeType: 'plate', width: 2, depth: 2, thickness: 0.1 },
    lang === 'ja' ? '熱伝導平板' : 'Heat Conduction Plate',
  );
  addTopology(ir, shape, 'cad_brep');

  const material = createMaterialFromLibrary(MATERIAL_LIBRARY[0], lang);
  const bodySelection = bodySelectionFor(shape, 'thermal_domain', lang === 'ja' ? '熱伝導領域' : 'Thermal Domain');
  const coldFace = requireFace(shape.faces, 'left');
  const heatedFace = requireFace(shape.faces, 'right');
  const coldSelection = faceSelection(
    'reference_temperature_face',
    lang === 'ja' ? '基準温度面' : 'Reference Temperature Face',
    [coldFace],
    '#2196f3',
    ['boundary_condition', 'export_tag'],
  );
  const heatedSelection = faceSelection(
    'heated_face',
    lang === 'ja' ? '加熱面' : 'Heated Face',
    [heatedFace],
    '#f44336',
    ['load', 'export_tag'],
  );
  const temperature: BoundaryCondition = {
    id: generateId('boundary_condition'),
    name: 'reference_temperature',
    physics_domain: 'thermal',
    bc_type: 'temperature',
    target_named_selection_id: coldSelection.id,
    coordinate_system: 'global',
    values: { scalar: 293.15 },
    temporal_profile: 'constant',
    status: 'confirmed',
    notes: '',
  };
  const heatInput: Load = {
    id: generateId('load'),
    name: lang === 'ja' ? '表面熱源' : 'Surface Heat Input',
    physics_domain: 'thermal',
    load_type: 'heat_source',
    target_named_selection_id: heatedSelection.id,
    application_mode: 'per_area',
    direction: [1, 0, 0],
    magnitude: 2_000,
    distribution: 'uniform',
    temporal_profile: 'constant',
    load_case: 'default',
    coordinate_system: 'global',
    status: 'confirmed',
  };

  ir.materials.push(material);
  ir.named_selections.push(bodySelection, coldSelection, heatedSelection);
  ir.material_assignments.push({
    id: generateId('material_assignment'),
    material_id: material.id,
    target_named_selection_id: bodySelection.id,
    override_allowed: false,
  });
  ir.boundary_conditions.push(temperature);
  ir.loads.push(heatInput);
  ir.mesh_controls.global.global_size = 0.08;
  addAnalysisCase(ir, {
    domain: 'thermal',
    type: 'steady_thermal',
    hint: 'dolfinx_steady_heat',
    lang,
    materials: [material.id],
    boundaryConditions: [temperature.id],
    loads: [heatInput.id],
    results: ['temperature'],
  });
  configureSolver(ir, 'DOLFINx');
}

function applyFluidTemplate(ir: ProjectIR, lang: string): void {
  const shape = generateShape(
    { shapeType: 'channel', length: 6, height: 1, depth: 0.1 },
    lang === 'ja' ? '2Dチャネル流路' : '2D Channel',
  );
  shape.body.metadata.dimensionality = '2D';
  addTopology(ir, shape, 'cad_brep');

  const water = createMaterialFromLibrary(MATERIAL_LIBRARY[3], lang);
  const bodySelection = bodySelectionFor(shape, 'fluid_domain', lang === 'ja' ? '流体領域' : 'Fluid Domain');
  const inletSelection = faceSelection(
    'inlet',
    lang === 'ja' ? '入口' : 'Inlet',
    [requireFace(shape.faces, 'inlet')],
    '#2196f3',
    ['boundary_condition', 'export_tag'],
  );
  const outletSelection = faceSelection(
    'outlet',
    lang === 'ja' ? '出口' : 'Outlet',
    [requireFace(shape.faces, 'outlet')],
    '#f44336',
    ['boundary_condition', 'export_tag'],
  );
  const topWallSelection = faceSelection(
    'wall_top',
    lang === 'ja' ? '上壁' : 'Top Wall',
    [requireFace(shape.faces, 'wall_top')],
    '#78909c',
    ['boundary_condition', 'export_tag'],
  );
  const bottomWallSelection = faceSelection(
    'wall_bottom',
    lang === 'ja' ? '下壁' : 'Bottom Wall',
    [requireFace(shape.faces, 'wall_bottom')],
    '#607d8b',
    ['boundary_condition', 'export_tag'],
  );

  const inlet: BoundaryCondition = {
    id: generateId('boundary_condition'),
    name: 'velocity_inlet',
    physics_domain: 'fluid',
    bc_type: 'velocity_inlet',
    target_named_selection_id: inletSelection.id,
    coordinate_system: 'global',
    // Re ≈ 182 for the 1 m × 0.1 m water channel: deliberately laminar.
    values: { vector: [0.001, 0, 0] },
    temporal_profile: 'constant',
    status: 'confirmed',
    notes: '',
  };
  const outlet: BoundaryCondition = {
    id: generateId('boundary_condition'),
    name: 'pressure_outlet',
    physics_domain: 'fluid',
    bc_type: 'pressure_outlet',
    target_named_selection_id: outletSelection.id,
    coordinate_system: 'global',
    values: { scalar: 0, pressure_basis: 'dynamic' },
    temporal_profile: 'constant',
    status: 'confirmed',
    notes: '',
  };
  const topWall = wallCondition('top_wall', topWallSelection.id);
  const bottomWall = wallCondition('bottom_wall', bottomWallSelection.id);

  ir.materials.push(water);
  ir.named_selections.push(
    bodySelection,
    inletSelection,
    outletSelection,
    topWallSelection,
    bottomWallSelection,
  );
  ir.material_assignments.push({
    id: generateId('material_assignment'),
    material_id: water.id,
    target_named_selection_id: bodySelection.id,
    override_allowed: false,
  });
  ir.boundary_conditions.push(inlet, outlet, topWall, bottomWall);
  ir.mesh_controls.global.global_size = 0.1;
  addAnalysisCase(ir, {
    domain: 'fluid',
    type: 'incompressible_flow_steady',
    hint: 'openfoam_simpleFoam',
    lang,
    materials: [water.id],
    boundaryConditions: [inlet.id, outlet.id, topWall.id, bottomWall.id],
    results: ['velocity', 'pressure'],
  });
  configureSolver(ir, 'OpenFOAM', {
    application: 'simpleFoam',
    dimensionality: '2D',
    front_back_type: 'empty',
    front_back_name: 'frontAndBack',
  });
}

function addTopology(
  ir: ProjectIR,
  shape: GeneratedTopology,
  modelType: ProjectIR['geometry']['model_type'],
): void {
  ir.geometry.model_type = modelType;
  ir.geometry.source = 'native';
  ir.geometry.bodies.push(shape.body);
  ir.geometry.faces.push(...shape.faces);
  ir.geometry.edges.push(...shape.edges);
  ir.geometry.vertices.push(...shape.vertices);
}

interface SelectionInput {
  name: string;
  displayName: string;
  dimension: NamedSelection['target_dimension'];
  entityType: NamedSelection['entity_type'];
  memberRefs: string[];
  color: string;
  usages: NamedSelectionUsage[];
}

function createSelection(input: SelectionInput): NamedSelection {
  if (input.memberRefs.length === 0) {
    throw new Error(`Template named selection "${input.name}" cannot be empty.`);
  }
  return {
    id: generateId('named_selection'),
    name: input.name,
    display_name: input.displayName,
    target_dimension: input.dimension,
    entity_type: input.entityType,
    member_refs: [...input.memberRefs],
    color: input.color,
    description: '',
    created_by: 'user',
    status: 'active',
    usages: [...input.usages],
  };
}

function faceSelection(
  name: string,
  displayName: string,
  faces: GeometryFace[],
  color: string,
  usages: NamedSelectionUsage[],
): NamedSelection {
  return createSelection({
    name,
    displayName,
    dimension: 2,
    entityType: 'face',
    memberRefs: faces.map((face) => face.id),
    color,
    usages,
  });
}

function bodySelectionFor(
  shape: GeneratedTopology,
  name: string,
  displayName: string,
): NamedSelection {
  return createSelection({
    name,
    displayName,
    dimension: 3,
    entityType: 'body',
    memberRefs: [shape.body.id],
    color: shape.body.color,
    usages: ['material_assignment', 'export_tag'],
  });
}

function requireFace(faces: GeometryFace[], name: string): GeometryFace {
  const face = faces.find((candidate) => candidate.name === name);
  if (!face) throw new Error(`Template geometry is missing required face "${name}".`);
  return face;
}

function verticesAtY(vertices: GeometryVertex[], y: number): GeometryVertex[] {
  return vertices.filter((vertex) => Math.abs(vertex.position[1] - y) <= POSITION_TOLERANCE);
}

function extremeVertex(
  vertices: GeometryVertex[],
  axis: 0 | 1 | 2,
  direction: 'min' | 'max',
): GeometryVertex {
  if (vertices.length === 0) throw new Error('Template geometry has no candidate vertices.');
  return vertices.reduce((best, candidate) => {
    if (direction === 'min') {
      return candidate.position[axis] < best.position[axis] ? candidate : best;
    }
    return candidate.position[axis] > best.position[axis] ? candidate : best;
  });
}

function structuralSupport(
  name: string,
  targetSelectionId: string,
  dofMap: NonNullable<BoundaryCondition['values']['dof_map']>,
): BoundaryCondition {
  return {
    id: generateId('boundary_condition'),
    name,
    physics_domain: 'structural',
    bc_type: 'fixed',
    target_named_selection_id: targetSelectionId,
    coordinate_system: 'global',
    values: { dof_map: dofMap },
    temporal_profile: 'constant',
    status: 'confirmed',
    notes: '',
  };
}

function wallCondition(name: string, targetSelectionId: string): BoundaryCondition {
  return {
    id: generateId('boundary_condition'),
    name,
    physics_domain: 'fluid',
    bc_type: 'no_slip',
    target_named_selection_id: targetSelectionId,
    coordinate_system: 'global',
    values: { vector: [0, 0, 0] },
    temporal_profile: 'constant',
    status: 'confirmed',
    notes: '',
  };
}

interface AnalysisCaseInput {
  domain: DomainType;
  type: AnalysisCase['analysis_type'];
  hint: SolverProfileHint;
  lang: string;
  materials?: string[];
  sections?: string[];
  boundaryConditions?: string[];
  loads?: string[];
  results: ResultRequest[];
}

function addAnalysisCase(ir: ProjectIR, input: AnalysisCaseInput): void {
  const analysisCase: AnalysisCase = {
    id: generateId('analysis_case'),
    name: input.lang === 'ja' ? 'デフォルトケース' : 'Default Case',
    active: true,
    domain_type: input.domain,
    analysis_type: input.type,
    nonlinear: false,
    transient: false,
    participating_material_ids: [...(input.materials ?? [])],
    participating_section_ids: [...(input.sections ?? [])],
    participating_bc_ids: [...(input.boundaryConditions ?? [])],
    participating_load_ids: [...(input.loads ?? [])],
    participating_ic_ids: [],
    mesh_policy_ref: '',
    solver_profile_hint: input.hint,
    result_requests: [...input.results],
  };
  ir.analysis_cases.push(analysisCase);
}

function configureSolver(
  ir: ProjectIR,
  targetName: SolverTargetName,
  solverOptions?: Record<string, unknown>,
): void {
  ir.meta.domain_type = ir.analysis_cases.at(-1)?.domain_type ?? ir.meta.domain_type;
  ir.meta.default_solver_target = targetName;

  for (const target of ir.solver_targets) {
    target.enabled = target.target_name === targetName;
    if (target.target_name === targetName) {
      target.export_profile = 'strict';
      if (solverOptions) target.solver_options = { ...solverOptions };
    }
  }
}
