import type { BCValues, BoundaryCondition, InitialCondition, Load, MaterialParameterKey, ProjectIR } from '@/core/ir/types';
import { quantityUnitLabel, type QuantityKind } from '@/core/units';
import { getParticipationMode, PARTICIPATION_FIELDS } from '@/core/ir/participation';
import { scopeProjectForAnalysisCaseValidation } from '@/export/compiler/capabilities';
import { convectionAmbientTemperature, convectionCoefficient } from '@/export/dolfinx/helpers';
import type { ArtifactScalar } from '@/export/shared/artifact-sanitization';

/** Reports deliberately retain canonical values, independently of display preferences. */
export const REPORT_UNIT_BASIS = 'SI (m, kg, s, N, K); geometry rotations in deg';

export interface ReportQuantity {
  name: string;
  value: number | string;
  unit: string;
}

export interface ReportTable {
  title: string;
  columns: string[];
  rows: ArtifactScalar[][];
}

export const MATERIAL_REPORT_PARAMETERS: ReadonlyArray<{ key: MaterialParameterKey; label: string; quantity: QuantityKind }> = [
  { key: 'young_modulus', label: 'E', quantity: 'stress' },
  { key: 'poisson_ratio', label: 'Poisson ratio', quantity: 'dimensionless' },
  { key: 'density', label: 'Density', quantity: 'density' },
  { key: 'thermal_conductivity', label: 'Thermal conductivity', quantity: 'thermal_conductivity' },
  { key: 'specific_heat', label: 'Specific heat', quantity: 'specific_heat' },
  { key: 'dynamic_viscosity', label: 'Dynamic viscosity μ', quantity: 'dynamic_viscosity' },
  { key: 'kinematic_viscosity', label: 'Kinematic viscosity ν', quantity: 'kinematic_viscosity' },
];

const unit = (kind: QuantityKind) => kind === 'dimensionless' ? '1' : quantityUnitLabel(kind, 'SI');
const quantity = (name: string, value: number | string, kind: QuantityKind): ReportQuantity => ({ name, value, unit: unit(kind) });
const vectorText = (values: readonly number[]) => `[${values.join(', ')}]`;

function conditionQuantity(type: BoundaryCondition['bc_type'] | InitialCondition['ic_type'], values: BCValues): QuantityKind {
  if (type === 'temperature' || type === 'initial_temperature') return 'temperature';
  if (type === 'heat_flux') return 'heat_flux';
  if (type === 'pressure_outlet' || type === 'initial_pressure') {
    return values.pressure_basis === 'kinematic' ? 'kinematic_pressure' : 'pressure';
  }
  if (type === 'velocity_inlet' || type === 'initial_velocity' || type === 'wall' || type === 'no_slip' || type === 'slip') return 'velocity';
  if (type === 'fixed' || type === 'prescribed_displacement' || type === 'initial_displacement' || type === 'symmetry') return 'length';
  return 'dimensionless';
}

/** The same quantity interpretation is used by both report serializers. */
export function conditionReportQuantities(condition: BoundaryCondition | InitialCondition): ReportQuantity[] {
  const values = condition.values;
  const type = 'bc_type' in condition ? condition.bc_type : condition.ic_type;
  const quantities: ReportQuantity[] = [];
  if ('bc_type' in condition && condition.bc_type === 'convection') {
    const coefficient = convectionCoefficient(condition);
    const ambient = convectionAmbientTemperature(condition);
    if (coefficient !== undefined) quantities.push(quantity('heat_transfer_coefficient', coefficient, 'convection_coefficient'));
    if (ambient !== undefined) quantities.push(quantity('ambient_temperature', ambient, 'temperature'));
  } else {
    const kind = conditionQuantity(type, values);
    if (values.scalar !== undefined) quantities.push(quantity('scalar', values.scalar, kind));
    if (values.vector) values.vector.forEach((value, index) => quantities.push(quantity(`vector.${['x', 'y', 'z'][index]}`, value, kind)));
  }
  if (values.dof_map) {
    for (const [dof, state] of Object.entries(values.dof_map)) quantities.push({ name: `dof.${dof}`, value: state, unit: 'state' });
  }
  if (values.pressure_basis !== undefined) quantities.push({ name: 'pressure_basis', value: values.pressure_basis, unit: 'basis' });
  if (values.function_ref !== undefined) quantities.push({ name: 'function_ref', value: values.function_ref, unit: 'reference' });
  return quantities;
}

export function loadReportQuantity(load: Pick<Load, 'load_type' | 'application_mode' | 'magnitude'>): ReportQuantity {
  if (load.load_type === 'gravity') return quantity('magnitude', load.magnitude, 'acceleration');
  if (load.load_type === 'mass_flow_rate') return quantity('magnitude', load.magnitude, 'mass_flow_rate');
  const thermal = load.load_type === 'heat_source' || load.load_type === 'volumetric_heat';
  if (load.application_mode === 'total') return quantity('magnitude', load.magnitude, thermal ? 'power' : 'force');
  if (load.application_mode === 'per_area') return quantity('magnitude', load.magnitude, thermal ? 'heat_flux' : load.load_type === 'pressure' ? 'pressure' : 'surface_load');
  if (load.application_mode === 'per_volume') return quantity('magnitude', load.magnitude, thermal ? 'volumetric_heat' : 'volume_load');
  return thermal ? { name: 'magnitude', value: load.magnitude, unit: 'W/m' } : quantity('magnitude', load.magnitude, 'line_load');
}

export function formatReportQuantities(quantities: ReportQuantity[]): string {
  return quantities.map((item) => `${item.name}=${item.value} [${item.unit}]`).join('; ');
}

function targetName(ir: ProjectIR, id: string): string {
  const selection = ir.named_selections.find((item) => item.id === id);
  return selection ? `${selection.display_name ?? selection.name} (${id})` : id;
}

export function buildConditionReportTables(ir: ProjectIR): ReportTable[] {
  return [
    { title: 'Materials', columns: ['Name', 'Class', ...MATERIAL_REPORT_PARAMETERS.map((item) => `${item.label} [${unit(item.quantity)}]`)],
      rows: ir.materials.map((material) => [material.name, material.class, ...MATERIAL_REPORT_PARAMETERS.map((item) => material.parameter_set[item.key].value)]) },
    { title: 'Sections', columns: ['Name', 'Type', 'Area [m²]', 'Iy [m⁴]', 'Iz [m⁴]', 'J [m⁴]', 'Thickness [m]'],
      rows: ir.sections.map((section) => [section.name, section.section_type, section.area, section.inertia_y, section.inertia_z, section.torsion_constant, section.thickness]) },
    { title: 'Named Selections', columns: ['Name', 'ID', 'Entity type', 'Status', 'Member count [1]', 'Member IDs'],
      rows: ir.named_selections.map((selection) => [selection.display_name ?? selection.name, selection.id, selection.entity_type, selection.status, selection.member_refs.length, selection.member_refs.join('; ')]) },
    { title: 'Boundary Conditions', columns: ['Name', 'ID', 'Type', 'Domain', 'Target', 'Coordinate system', 'Temporal profile', 'Values (quantity=value [unit])'],
      rows: ir.boundary_conditions.map((condition) => [condition.name, condition.id, condition.bc_type, condition.physics_domain, targetName(ir, condition.target_named_selection_id), condition.coordinate_system, condition.temporal_profile, formatReportQuantities(conditionReportQuantities(condition))]) },
    { title: 'Loads', columns: ['Name', 'ID', 'Type', 'Domain', 'Target', 'Magnitude', 'Unit', 'Direction [1]', 'Application mode', 'Coordinate system', 'Distribution', 'Temporal profile', 'Load case'],
      rows: ir.loads.map((load) => [load.name, load.id, load.load_type, load.physics_domain, targetName(ir, load.target_named_selection_id), load.magnitude, loadReportQuantity(load).unit, vectorText(load.direction), load.application_mode, load.coordinate_system, load.distribution, load.temporal_profile, load.load_case]) },
    { title: 'Initial Conditions', columns: ['Name', 'ID', 'Type', 'Domain', 'Target', 'Values (quantity=value [unit])'],
      rows: ir.initial_conditions.map((condition) => [condition.name, condition.id, condition.ic_type, condition.physics_domain, targetName(ir, condition.target_named_selection_id), formatReportQuantities(conditionReportQuantities(condition))]) },
  ];
}

/** Reproduction details retain identifiers and explicit participation intent. */
export function buildReproductionReportTables(ir: ProjectIR): ReportTable[] {
  const participationRows: ArtifactScalar[][] = [];
  for (const analysisCase of ir.analysis_cases) {
    const scope = scopeProjectForAnalysisCaseValidation(ir, analysisCase.id);
    const collections = { participating_material_ids: scope.materials, participating_section_ids: scope.sections,
      participating_bc_ids: scope.boundary_conditions, participating_load_ids: scope.loads, participating_ic_ids: scope.initial_conditions };
    for (const field of PARTICIPATION_FIELDS) participationRows.push([
      analysisCase.name, analysisCase.id, field, getParticipationMode(analysisCase, field), analysisCase[field].join('; '), collections[field].map((item) => item.id).join('; '),
    ]);
  }
  return [
    { title: 'Body Transforms', columns: ['Body', 'ID', 'Position [m]', 'Rotation XYZ [deg]', 'Scale XYZ [1]', 'Asset reference'],
      rows: ir.geometry.bodies.map((body) => [body.name, body.id, vectorText(body.transform.position), vectorText(body.transform.rotation), vectorText(body.transform.scale), body.asset_ref]) },
    { title: 'Material Assignments', columns: ['ID', 'Material', 'Material ID', 'Target', 'Override allowed'],
      rows: ir.material_assignments.map((assignment) => [assignment.id, ir.materials.find((material) => material.id === assignment.material_id)?.name, assignment.material_id, targetName(ir, assignment.target_named_selection_id), assignment.override_allowed]) },
    { title: 'Section Assignments', columns: ['ID', 'Section', 'Section ID', 'Target'],
      rows: ir.section_assignments.map((assignment) => [assignment.id, ir.sections.find((section) => section.id === assignment.section_id)?.name, assignment.section_id, targetName(ir, assignment.target_named_selection_id)]) },
    { title: 'Section Definitions', columns: ['Name', 'ID', 'Material ID', 'Orientation reference', 'Dimensions [m]'],
      rows: ir.sections.map((section) => [section.name, section.id, section.material_id, section.orientation_ref, Object.entries(section.dimensions).map(([key, value]) => `${key}=${value}`).join('; ')]) },
    { title: 'Global Mesh Controls', columns: ['Size [m]', 'Algorithm', 'Growth rate [1]', 'Element order [1]', 'Recombine', 'Curvature refinement'],
      rows: [[ir.mesh_controls.global.global_size, ir.mesh_controls.global.algorithm_preference, ir.mesh_controls.global.growth_rate, ir.mesh_controls.global.element_order, ir.mesh_controls.global.recombine_preference, ir.mesh_controls.global.curvature_based_refinement]] },
    { title: 'Local Mesh Controls', columns: ['ID', 'Target', 'Type', 'Size [m]', 'Layers [1]', 'Bias [1]', 'Transfinite', 'Boundary layer', 'Priority [1]'],
      rows: ir.mesh_controls.local.map((control) => [control.id, targetName(ir, control.target_named_selection_id), control.control_type, control.size, control.layers, control.bias, control.transfinite_hint, control.boundary_layer_hint, control.priority]) },
    { title: 'Mesh Quality Targets', columns: ['Minimum Jacobian [1]', 'Maximum aspect ratio [1]', 'Minimum skewness [1]', 'Quality level'],
      rows: [[ir.mesh_controls.quality_targets.min_jacobian, ir.mesh_controls.quality_targets.max_aspect_ratio, ir.mesh_controls.quality_targets.min_skewness, ir.mesh_controls.quality_targets.preferred_quality_level]] },
    { title: 'Analysis Cases', columns: ['Name', 'ID', 'Active', 'Domain', 'Analysis', 'Nonlinear', 'Transient', 'Solver profile', 'Mesh policy', 'Result requests'],
      rows: ir.analysis_cases.map((analysisCase) => [analysisCase.name, analysisCase.id, analysisCase.active, analysisCase.domain_type, analysisCase.analysis_type, analysisCase.nonlinear, analysisCase.transient, analysisCase.solver_profile_hint, analysisCase.mesh_policy_ref, analysisCase.result_requests.join('; ')]) },
    { title: 'Case Participation', columns: ['Case', 'Case ID', 'Collection', 'Mode', 'Stored IDs', 'Effective IDs'], rows: participationRows },
    { title: 'Solver Targets', columns: ['Solver', 'Enabled', 'Export profile', 'Packaging'],
      rows: ir.solver_targets.map((solver) => [solver.target_name, solver.enabled, solver.export_profile, solver.packaging]) },
  ];
}
