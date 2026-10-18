import { beforeEach, describe, expect, it } from 'vitest';
import type { BoundaryCondition, Load, UnitSystemName } from '@/core/ir/types';
import { fromSI } from '@/core/units';
import { participationUpdate } from '@/core/ir/participation';
import { applyTemplate } from '@/lib/project-templates';
import { useAppStore } from '@/state/store';
import { exportConditionsCsv } from '@/export/project/csv-export';
import { exportMarkdownReport, exportMarkdownSummary } from '@/export/project/markdown-summary';
import { buildConditionReportTables, buildReproductionReportTables, conditionReportQuantities, loadReportQuantity } from '@/export/project/report-data';
import { parseProjectFile } from '@/export/project/load';
import { phase2En, phase2Ja } from '@/i18n/locales/phase2';

beforeEach(() => { useAppStore.getState().createProject('Report test', 'thermal'); applyTemplate('thermal', 'en'); });

function thermalProject() {
  const project = structuredClone(useAppStore.getState().ir);
  project.boundary_conditions.push({
    ...project.boundary_conditions[0], id: 'convection', name: 'Cooling', bc_type: 'convection',
    values: { heat_transfer_coefficient: 25, ambient_temperature: 300 }, coordinate_system: 'local-frame',
  });
  project.materials[0].parameter_set.dynamic_viscosity = { value: 0.001, status: 'confirmed' };
  project.materials[0].parameter_set.kinematic_viscosity = { value: 0.000001, status: 'confirmed' };
  project.sections.push({ id: 'section', name: 'Beam', section_type: 'generic_frame_section',
    material_id: project.materials[0].id, dimensions: {}, area: 0.02, inertia_y: 0.0003,
    inertia_z: 0.0004, torsion_constant: 0.0005, thickness: 0.006, metadata: {} });
  return project;
}

describe('canonical SI condition reports', () => {
  it.each<UnitSystemName>(['SI', 'mm-N-s', 'mm-t-s'])('keeps values and their explicit units consistent for display system %s', (system) => {
    const ir = thermalProject();
    ir.units.system_name = system;
    const before = structuredClone(ir);
    const csv = exportConditionsCsv(ir);
    const summary = exportMarkdownSummary(ir);
    for (const report of [csv, summary]) {
      expect(report).toContain('Report units');
      expect(report).toContain('SI (m, kg, s, N, K)');
      expect(report).toContain('205000000000');
      expect(report).toContain('E [Pa]');
      expect(report).toContain('Density [kg/m³]');
      expect(report).toContain('Thermal conductivity [W/(m·K)]');
      expect(report).toContain('Specific heat [J/(kg·K)]');
      expect(report).toContain('Dynamic viscosity μ [Pa·s]');
      expect(report).toContain('Kinematic viscosity ν [m²/s]');
      expect(report).toContain('Area [m²]');
      expect(report).toContain('Iy [m⁴]');
      expect(report).toContain('Thickness [m]');
      expect(report).toContain('heat_transfer_coefficient=25 [W/(m²·K)]');
      expect(report).toContain('ambient_temperature=300 [K]');
      expect(report).toContain('local-frame');
    }
    const materialRow = buildConditionReportTables(ir).find((table) => table.title === 'Materials')!.rows[0];
    expect(materialRow[2]).toBe(ir.materials[0].parameter_set.young_modulus.value);
    expect(fromSI(Number(materialRow[2]), 'stress', system)).toBe(system === 'SI' ? 205e9 : 205000);
    const sectionRow = buildConditionReportTables(ir).find((table) => table.title === 'Sections')!.rows[0];
    expect(sectionRow.slice(2)).toEqual([0.02, 0.0003, 0.0004, 0.0005, 0.006]);
    expect(ir).toEqual(before);
  });

  it('resolves current and legacy convection through the same coefficient and ambient-temperature semantics', () => {
    const base = thermalProject().boundary_conditions[1];
    const legacy = { ...base, values: { scalar: 25, vector: [300, 0, 0] as [number, number, number] } };
    expect(conditionReportQuantities(legacy)).toEqual(conditionReportQuantities(base));
    const explicit = { ...legacy, values: { ...legacy.values, heat_transfer_coefficient: 30, ambient_temperature: 310 } };
    expect(conditionReportQuantities(explicit)).toEqual([
      { name: 'heat_transfer_coefficient', value: 30, unit: 'W/(m²·K)' },
      { name: 'ambient_temperature', value: 310, unit: 'K' },
    ]);
  });

  it('retains every vector component, DOF state, pressure basis and function reference', () => {
    const base = thermalProject().boundary_conditions[0];
    const displacement: BoundaryCondition = { ...base, physics_domain: 'structural', bc_type: 'prescribed_displacement', values: {
      scalar: 0.00001234, vector: [0.1, -0.2, 0.3],
      dof_map: { ux: 'prescribed', uy: 'free', uz: 'fixed', rx: 'fixed', ry: 'free', rz: 'fixed' }, function_ref: 'ramp-1',
    } };
    const values = conditionReportQuantities(displacement);
    expect(values).toContainEqual({ name: 'scalar', value: 0.00001234, unit: 'm' });
    expect(values).toContainEqual({ name: 'vector.y', value: -0.2, unit: 'm' });
    expect(values).toContainEqual({ name: 'dof.uy', value: 'free', unit: 'state' });
    expect(values).toContainEqual({ name: 'dof.rx', value: 'fixed', unit: 'state' });
    expect(values).toContainEqual({ name: 'function_ref', value: 'ramp-1', unit: 'reference' });
    for (const basis of ['dynamic', 'kinematic'] as const) {
      const pressure: BoundaryCondition = { ...base, physics_domain: 'fluid', bc_type: 'pressure_outlet', values: { scalar: 123, pressure_basis: basis } };
      expect(conditionReportQuantities(pressure)).toEqual([
        { name: 'scalar', value: 123, unit: basis === 'dynamic' ? 'Pa' : 'm²/s²' },
        { name: 'pressure_basis', value: basis, unit: 'basis' },
      ]);
    }
  });

  it.each<[Load['load_type'], Load['application_mode'], string]>([
    ['nodal_force', 'total', 'N'], ['surface_traction', 'per_area', 'N/m²'], ['body_force', 'per_volume', 'N/m³'],
    ['gravity', 'total', 'm/s²'], ['line_load', 'per_length', 'N/m'], ['pressure', 'per_area', 'Pa'],
    ['heat_source', 'total', 'W'], ['heat_source', 'per_area', 'W/m²'], ['volumetric_heat', 'per_volume', 'W/m³'], ['mass_flow_rate', 'total', 'kg/s'],
  ])('labels %s with application mode %s as %s', (load_type, application_mode, expected) => {
    expect(loadReportQuantity({ load_type, application_mode, magnitude: 7 })).toEqual({ name: 'magnitude', value: 7, unit: expected });
  });
});

describe('reproduction report', () => {
  it('preserves all inputs in a loadable snapshot and distinguishes summary from reproduction details', () => {
    const ir = thermalProject();
    ir.analysis_cases[0] = { ...ir.analysis_cases[0], ...participationUpdate(ir.analysis_cases[0], 'participating_load_ids', []) };
    ir.mesh_controls.local.push({ id: 'local-mesh', target_named_selection_id: ir.named_selections[0].id, control_type: 'local_size', size: 0.01234, layers: null, bias: null, transfinite_hint: false, boundary_layer_hint: false, priority: 1 });
    const report = exportMarkdownReport(ir);
    const summary = exportMarkdownSummary(ir);
    for (const heading of ['Material Assignments', 'Section Definitions', 'Global Mesh Controls', 'Local Mesh Controls', 'Mesh Quality Targets', 'Analysis Cases', 'Case Participation', 'Project input snapshot']) {
      expect(report).toContain(`## ${heading}`);
      expect(summary).not.toContain(`## ${heading}`);
    }
    const participation = buildReproductionReportTables(ir).find((table) => table.title === 'Case Participation')!.rows;
    expect(participation.find((row) => row[2] === 'participating_load_ids')?.slice(3)).toEqual(['none', '', '']);
    const snapshot = report.match(/\n```json\n([\s\S]+)\n```\n/)?.[1];
    expect(snapshot).toBeDefined();
    const restored = parseProjectFile(snapshot!);
    expect(restored.success).toBe(true);
    expect(restored.data!.boundary_conditions).toEqual(ir.boundary_conditions);
    expect(restored.data!.mesh_controls).toEqual(ir.mesh_controls);
    expect(restored.data!.analysis_cases[0].participation_modes?.participating_load_ids).toBe('none');
    expect(restored.data!.geometry).toEqual(ir.geometry);
  });

  it('shows legacy all and explicit selection without conflating an explicitly empty selection', () => {
    const ir = thermalProject();
    const analysisCase = ir.analysis_cases[0];
    analysisCase.participating_load_ids = [];
    let table = buildReproductionReportTables(ir).find((item) => item.title === 'Case Participation')!;
    expect(table.rows.find((row) => row[2] === 'participating_load_ids')?.slice(3)).toEqual(['all', '', ir.loads.map((load) => load.id).join('; ')]);
    Object.assign(analysisCase, participationUpdate(analysisCase, 'participating_load_ids', [ir.loads[0].id]));
    table = buildReproductionReportTables(ir).find((item) => item.title === 'Case Participation')!;
    expect(table.rows.find((row) => row[2] === 'participating_load_ids')?.slice(3)).toEqual(['explicit', ir.loads[0].id, ir.loads[0].id]);
    Object.assign(analysisCase, participationUpdate(analysisCase, 'participating_load_ids', [], 'explicit'));
    table = buildReproductionReportTables(ir).find((item) => item.title === 'Case Participation')!;
    expect(table.rows.find((row) => row[2] === 'participating_load_ids')?.slice(3)).toEqual(['explicit', '', '']);
  });

  it('contains hostile text inside a safe snapshot fence and escapes visible tables', () => {
    const ir = thermalProject();
    ir.meta.description = '```\n<script>evil()</script>\n```';
    ir.materials[0].name = 'Steel | <script>';
    const report = exportMarkdownReport(ir);
    expect(report).toContain('\n````json\n');
    expect(report).toContain('Steel \\| &lt;script&gt;');
    const snapshot = report.match(/\n````json\n([\s\S]+)\n````\n/)?.[1];
    expect(JSON.parse(snapshot!).meta.description).toBe(ir.meta.description);
  });

  it('omits binary asset payloads and explains the companion bundle requirement', () => {
    const ir = thermalProject();
    ir.assets.push({ id: 'mesh-asset', kind: 'stl_mesh', file_name: 'part.stl', media_type: 'model/stl', encoding: 'base64',
      data: 'PRIVATE_LARGE_MESH_PAYLOAD', content_hash: 'sha256:mesh-hash', byte_length: 99, source_unit: 'm', scale_to_meters: 1,
      triangle_count: 1, bounds: { min: [0, 0, 0], max: [1, 1, 1] }, diagnostics: { degenerate_triangles: 0, finite_coordinates: true, watertight: false, manifold: false },
      cad_source: { format: 'step', file_name: 'part.step', media_type: 'model/step', encoding: 'base64', data: 'PRIVATE_CAD_PAYLOAD', content_hash: 'sha256:cad-hash', byte_length: 100 },
    });
    const report = exportMarkdownReport(ir);
    expect(report).not.toContain('PRIVATE_LARGE_MESH_PAYLOAD');
    expect(report).not.toContain('PRIVATE_CAD_PAYLOAD');
    expect(report).toContain('sha256:mesh-hash');
    expect(report).toContain('sha256:cad-hash');
    expect(report).toContain('this JSON cannot be loaded by itself');
    expect(report).toContain('companion .fem.zip bundle');
  });

  it('names dynamic and kinematic viscosity consistently in Japanese and English', () => {
    expect(phase2Ja.materials.dynamicViscosity).toBe('粘度（粘性係数 μ）');
    expect(phase2Ja.materials.kinematicViscosity).toBe('動粘度（動粘性係数 ν）');
    expect(phase2En.materials.dynamicViscosity).toContain('Dynamic');
    expect(phase2En.materials.kinematicViscosity).toContain('Kinematic');
    expect(phase2Ja.materials.viscosityRelation).toContain('ν = μ / ρ');
  });
});
