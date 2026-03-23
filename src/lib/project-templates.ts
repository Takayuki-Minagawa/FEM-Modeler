import { useAppStore } from '@/state/store';
import { generateId } from '@/core/ir/id-generator';
import { generateShape } from '@/geometry/primitives/generators';
import { createMaterialFromLibrary, MATERIAL_LIBRARY } from './material-library';
import type { DomainType, BoundaryCondition, Load, AnalysisCase, Section, SolverProfileHint } from '@/core/ir/types';

/**
 * After creating a project from a template, populate it with sample data
 * so the user can immediately see a working model.
 */
export function applyTemplate(domain: DomainType, lang: string) {
  const store = useAppStore.getState();

  switch (domain) {
    case 'frame': return applyFrameTemplate(store, lang);
    case 'truss': return applyTrussTemplate(store, lang);
    case 'solid': return applySolidTemplate(store, lang);
    case 'thermal': return applyThermalTemplate(store, lang);
    case 'fluid': return applyFluidTemplate(store, lang);
    default: break;
  }
}

function applyFrameTemplate(store: ReturnType<typeof useAppStore.getState>, lang: string) {
  // Geometry
  const shape = generateShape({ shapeType: 'frame2d', spanX: 6, spanY: 9, columns: 3, floors: 3 }, lang === 'ja' ? '2Dフレーム' : '2D Frame');
  store.addBody(shape.body);
  useAppStore.setState((s) => { s.ir.geometry.vertices.push(...shape.vertices); });

  // Material
  const mat = createMaterialFromLibrary(MATERIAL_LIBRARY[0], lang); // Steel
  store.addMaterial(mat);

  // Section
  const sec: Section = {
    id: generateId('section'), name: lang === 'ja' ? 'H形断面' : 'H-Section',
    section_type: 'beam_h', dimensions: { width: 0.2, height: 0.4 },
    material_id: mat.id, area: 0.008, inertia_y: 2.0e-4, inertia_z: 1.0e-4,
    torsion_constant: 5.0e-6, thickness: null, metadata: {},
  };
  store.addSection(sec);

  // Named selections
  const nsSupport = { id: generateId('named_selection'), name: 'support_base', display_name: lang === 'ja' ? '基礎支点' : 'Base Support', target_dimension: 0 as const, entity_type: 'body' as const, member_refs: [shape.body.id], color: '#e53935', description: '', created_by: 'user' as const, status: 'active' as const, usages: [] };
  store.addNamedSelection(nsSupport);

  // BC
  const bc: BoundaryCondition = {
    id: generateId('boundary_condition'), name: 'fixed_support',
    physics_domain: 'structural', bc_type: 'fixed',
    target_named_selection_id: nsSupport.id, coordinate_system: 'global',
    values: { dof_map: { ux: 'fixed', uy: 'fixed', uz: 'fixed', rx: 'free', ry: 'free', rz: 'fixed' } },
    temporal_profile: 'constant', status: 'confirmed', notes: '',
  };
  store.addBoundaryCondition(bc);

  // Load
  const load: Load = {
    id: generateId('load'), name: lang === 'ja' ? '水平荷重' : 'Lateral Load',
    physics_domain: 'structural', load_type: 'nodal_force',
    target_named_selection_id: nsSupport.id, application_mode: 'total',
    direction: [1, 0, 0], magnitude: 10000, distribution: 'uniform',
    temporal_profile: 'constant', load_case: 'default', coordinate_system: 'global', status: 'confirmed',
  };
  store.addLoad(load);

  // Analysis case
  addAnalysisCase(store, 'frame', 'static_linear', 'openseespy_frame_basic', lang);

  // Enable solver
  enableSolver(store, 'OpenSeesPy');
}

function applyTrussTemplate(store: ReturnType<typeof useAppStore.getState>, lang: string) {
  const shape = generateShape({ shapeType: 'truss2d', span: 10, height: 2, divisions: 6 }, lang === 'ja' ? '2Dトラス' : '2D Truss');
  store.addBody(shape.body);
  const mat = createMaterialFromLibrary(MATERIAL_LIBRARY[0], lang);
  store.addMaterial(mat);
  const sec: Section = {
    id: generateId('section'), name: lang === 'ja' ? '丸鋼断面' : 'Round Bar',
    section_type: 'beam_circle', dimensions: { diameter: 0.05 },
    material_id: mat.id, area: 1.96e-3, inertia_y: null, inertia_z: null,
    torsion_constant: null, thickness: null, metadata: {},
  };
  store.addSection(sec);
  addAnalysisCase(store, 'truss', 'static_linear', 'openseespy_frame_basic', lang);
  enableSolver(store, 'OpenSeesPy');
}

function applySolidTemplate(store: ReturnType<typeof useAppStore.getState>, lang: string) {
  const shape = generateShape({ shapeType: 'plateWithHole', width: 4, depth: 2, thickness: 0.2, holeRadius: 0.3 }, lang === 'ja' ? '穴あき平板' : 'Plate with Hole');
  store.addBody(shape.body);
  useAppStore.setState((s) => { s.ir.geometry.faces.push(...shape.faces); });
  const mat = createMaterialFromLibrary(MATERIAL_LIBRARY[0], lang);
  store.addMaterial(mat);
  addAnalysisCase(store, 'solid', 'static_linear', 'dolfinx_linear_elasticity', lang);
  enableSolver(store, 'DOLFINx');
}

function applyThermalTemplate(store: ReturnType<typeof useAppStore.getState>, lang: string) {
  const shape = generateShape({ shapeType: 'plate', width: 2, depth: 2, thickness: 0.1 }, lang === 'ja' ? '平板' : 'Plate');
  store.addBody(shape.body);
  useAppStore.setState((s) => { s.ir.geometry.faces.push(...shape.faces); });
  const mat = createMaterialFromLibrary(MATERIAL_LIBRARY[0], lang);
  store.addMaterial(mat);
  addAnalysisCase(store, 'thermal', 'steady_thermal', 'dolfinx_steady_heat', lang);
  enableSolver(store, 'DOLFINx');
}

function applyFluidTemplate(store: ReturnType<typeof useAppStore.getState>, lang: string) {
  const shape = generateShape({ shapeType: 'channel', length: 6, height: 1, depth: 1 }, lang === 'ja' ? 'チャネル流路' : 'Channel');
  store.addBody(shape.body);
  useAppStore.setState((s) => {
    s.ir.geometry.faces.push(...shape.faces);
    s.ir.geometry.vertices.push(...shape.vertices);
  });

  const mat = createMaterialFromLibrary(MATERIAL_LIBRARY[3], lang); // Water
  store.addMaterial(mat);

  // Named selections for patches
  const nsInlet = { id: generateId('named_selection'), name: 'inlet', display_name: 'Inlet', target_dimension: 2 as const, entity_type: 'body' as const, member_refs: [shape.body.id], color: '#2196f3', description: '', created_by: 'user' as const, status: 'active' as const, usages: [] };
  const nsOutlet = { id: generateId('named_selection'), name: 'outlet', display_name: 'Outlet', target_dimension: 2 as const, entity_type: 'body' as const, member_refs: [shape.body.id], color: '#f44336', description: '', created_by: 'user' as const, status: 'active' as const, usages: [] };
  store.addNamedSelection(nsInlet);
  store.addNamedSelection(nsOutlet);

  // BCs
  const bcInlet: BoundaryCondition = {
    id: generateId('boundary_condition'), name: 'velocity_inlet',
    physics_domain: 'fluid', bc_type: 'velocity_inlet',
    target_named_selection_id: nsInlet.id, coordinate_system: 'global',
    values: { vector: [1, 0, 0] }, temporal_profile: 'constant', status: 'confirmed', notes: '',
  };
  const bcOutlet: BoundaryCondition = {
    id: generateId('boundary_condition'), name: 'pressure_outlet',
    physics_domain: 'fluid', bc_type: 'pressure_outlet',
    target_named_selection_id: nsOutlet.id, coordinate_system: 'global',
    values: { scalar: 0 }, temporal_profile: 'constant', status: 'confirmed', notes: '',
  };
  store.addBoundaryCondition(bcInlet);
  store.addBoundaryCondition(bcOutlet);

  addAnalysisCase(store, 'fluid', 'incompressible_flow_steady', 'openfoam_simpleFoam', lang);
  enableSolver(store, 'OpenFOAM');
}

function addAnalysisCase(store: ReturnType<typeof useAppStore.getState>, domain: DomainType, type: AnalysisCase['analysis_type'], hint: SolverProfileHint, lang: string) {
  const ac: AnalysisCase = {
    id: generateId('analysis_case'),
    name: lang === 'ja' ? 'デフォルトケース' : 'Default Case',
    active: true, domain_type: domain, analysis_type: type,
    nonlinear: false, transient: false,
    participating_material_ids: [], participating_section_ids: [],
    participating_bc_ids: [], participating_load_ids: [], participating_ic_ids: [],
    mesh_policy_ref: '', solver_profile_hint: hint, result_requests: ['displacement'],
  };
  store.addAnalysisCase(ac);
}

function enableSolver(_store: ReturnType<typeof useAppStore.getState>, name: string) {
  useAppStore.setState((state) => {
    for (const t of state.ir.solver_targets) {
      t.enabled = t.target_name === name;
    }
  });
}
