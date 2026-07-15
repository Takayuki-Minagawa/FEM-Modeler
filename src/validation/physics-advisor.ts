import type {
  BoundaryCondition,
  GeometryBody,
  GeometryEdge,
  Material,
  NamedSelection,
  ProjectIR,
  Section,
} from '@/core/ir/types';

export type PhysicsAdvisorMetricKind =
  | 'frame_slenderness'
  | 'reynolds_number'
  | 'biot_number'
  | 'fourier_number';

export type PhysicsAdvisorStatus = 'nominal' | 'caution' | 'warning';
export type PhysicsAdvisorSeverity = 'info' | 'warning';

export interface PhysicsAdvisorInput {
  name: string;
  value: number;
  unit: string;
  sourceRef?: string;
}

export interface PhysicsAdvisorMetric {
  id: string;
  kind: PhysicsAdvisorMetricKind;
  symbol: 'lambda' | 'Re' | 'Bi' | 'Fo';
  value: number;
  status: PhysicsAdvisorStatus;
  interpretation: string;
  inputs: PhysicsAdvisorInput[];
  targetRefs: string[];
}

export interface PhysicsAdvisorNotice {
  severity: PhysicsAdvisorSeverity;
  code: string;
  message: string;
  targetRefs: string[];
  metricId?: string;
}

export interface PhysicsAdvisorReport {
  metrics: PhysicsAdvisorMetric[];
  notices: PhysicsAdvisorNotice[];
}

interface ThermalDuration {
  seconds: number;
  sourceRef: string;
}

/**
 * Calculate advisory, dimensionless physics metrics only when their required
 * ProjectIR inputs are explicit and physically valid. Missing data produces a
 * typed notice rather than a fabricated default.
 */
export function buildPhysicsAdvisorReport(ir: ProjectIR): PhysicsAdvisorReport {
  const metrics: PhysicsAdvisorMetric[] = [];
  const notices: PhysicsAdvisorNotice[] = [];

  addNearIncompressibleNotices(ir, notices);
  addFrameSlendernessMetrics(ir, metrics, notices);
  addReynoldsMetrics(ir, metrics, notices);
  addThermalMetrics(ir, metrics, notices);

  return { metrics, notices };
}

export const analyzePhysicsAdvisories = buildPhysicsAdvisorReport;

function addFrameSlendernessMetrics(
  ir: ProjectIR,
  metrics: PhysicsAdvisorMetric[],
  notices: PhysicsAdvisorNotice[],
): void {
  let applicableAssignments = 0;
  for (const assignment of ir.section_assignments) {
    const section = ir.sections.find((candidate) => candidate.id === assignment.section_id);
    const selection = ir.named_selections.find((candidate) => candidate.id === assignment.target_named_selection_id);
    if (!section || !selection) continue;
    const edges = edgesForSelection(ir, selection);
    if (edges.length === 0) continue;
    applicableAssignments += 1;

    const properties = sectionSlendernessProperties(section);
    if (!properties) continue;
    const radius = Math.sqrt(properties.minimumInertia / properties.area);
    const effectiveLengthFactor = positiveNumber(section.metadata.effective_length_factor);
    if (!effectiveLengthFactor) continue;
    for (const edge of edges) {
      const length = transformedEdgeLength(ir, edge);
      if (length === null || length <= 0) continue;
      const slenderness = effectiveLengthFactor * length / radius;
      const status: PhysicsAdvisorStatus = slenderness > 120
        ? 'warning'
        : slenderness > 50 ? 'caution' : 'nominal';
      const metric: PhysicsAdvisorMetric = {
        id: `frame_slenderness:${assignment.id}:${edge.id}`,
        kind: 'frame_slenderness',
        symbol: 'lambda',
        value: slenderness,
        status,
        interpretation: status === 'warning'
          ? 'High member slenderness; check buckling, effective length, and second-order effects.'
          : status === 'caution'
            ? 'Moderate member slenderness; confirm the effective-length assumption and stability model.'
            : 'Member slenderness is below the generic advisory threshold.',
        inputs: [
          { name: 'effective length factor', value: effectiveLengthFactor, unit: '1', sourceRef: section.id },
          { name: 'member length', value: length, unit: 'm', sourceRef: edge.id },
          { name: 'section area', value: properties.area, unit: 'm2', sourceRef: section.id },
          { name: 'minimum second moment', value: properties.minimumInertia, unit: 'm4', sourceRef: section.id },
          { name: 'minimum radius of gyration', value: radius, unit: 'm', sourceRef: section.id },
        ],
        targetRefs: [edge.id, section.id, assignment.id],
      };
      metrics.push(metric);
      if (status !== 'nominal') {
        notices.push({
          severity: 'warning',
          code: status === 'warning' ? 'FRAME_SLENDERNESS_HIGH' : 'FRAME_SLENDERNESS_MODERATE',
          message: `${edge.name}: lambda=${formatMetric(slenderness)}. ${metric.interpretation}`,
          targetRefs: metric.targetRefs,
          metricId: metric.id,
        });
      }
    }
  }

  const structuralApplicable = ir.meta.domain_type === 'frame'
    || ir.meta.domain_type === 'truss'
    || ir.geometry.bodies.some((body) => body.category === 'beam_region');
  if (structuralApplicable && applicableAssignments > 0
    && !metrics.some((metric) => metric.kind === 'frame_slenderness')) {
    notices.push({
      severity: 'info',
      code: 'FRAME_SLENDERNESS_INPUTS_INCOMPLETE',
      message: 'Slenderness was not calculated because member length, area, a second moment of area, or an explicit effective-length factor K is missing.',
      targetRefs: ir.section_assignments.map((assignment) => assignment.id),
    });
  }
}

function addNearIncompressibleNotices(
  ir: ProjectIR,
  notices: PhysicsAdvisorNotice[],
): void {
  const assignmentIdsByMaterial = new Map<string, string[]>();
  for (const assignment of ir.material_assignments) {
    const ids = assignmentIdsByMaterial.get(assignment.material_id) ?? [];
    ids.push(assignment.id);
    assignmentIdsByMaterial.set(assignment.material_id, ids);
  }
  for (const material of ir.materials) {
    const poisson = material.parameter_set.poisson_ratio.value;
    const assignments = assignmentIdsByMaterial.get(material.id) ?? [];
    if (typeof poisson !== 'number' || !Number.isFinite(poisson) || poisson <= 0.45 || assignments.length === 0) continue;
    notices.push({
      severity: 'warning',
      code: 'NEAR_INCOMPRESSIBLE_LOCKING',
      message: `${material.name}: nu=${formatMetric(poisson)} is near incompressible. Standard displacement elements may lock; verify a mixed/selective-integration formulation and a mesh-convergence study.`,
      targetRefs: [material.id, ...assignments],
    });
  }
}

function addReynoldsMetrics(
  ir: ProjectIR,
  metrics: PhysicsAdvisorMetric[],
  notices: PhysicsAdvisorNotice[],
): void {
  const channelBodies = ir.geometry.bodies.filter((body) => body.metadata.shapeType === 'channel');
  const velocityInlets = ir.boundary_conditions.filter((condition) => condition.bc_type === 'velocity_inlet');

  for (const inlet of velocityInlets) {
    const selection = ir.named_selections.find((candidate) => candidate.id === inlet.target_named_selection_id);
    if (!selection) continue;
    const inletBodies = selectionBodyIds(ir, selection);
    for (const body of channelBodies.filter((candidate) => inletBodies.has(candidate.id))) {
      const height = scaledMetadataLength(body, 'height', 1);
      const depth = scaledMetadataLength(body, 'depth', 2);
      const velocity = inletVelocity(inlet);
      const material = materialForBody(ir, body.id);
      const transport = material ? fluidTransport(material) : null;
      if (!height || !depth || !velocity || !transport) continue;

      const hydraulicDiameter = 2 * height * depth / (height + depth);
      const reynolds = velocity * hydraulicDiameter / transport.kinematicViscosity;
      const status: PhysicsAdvisorStatus = reynolds >= 4_000
        ? 'warning'
        : reynolds >= 2_300 ? 'caution' : 'nominal';
      const interpretation = status === 'warning'
        ? 'Internal-flow Reynolds number is in a turbulent range; use a turbulence-capable model and resolve near-wall requirements.'
        : status === 'caution'
          ? 'Internal-flow Reynolds number is in a transitional range; laminar and turbulent assumptions are both sensitive.'
          : 'Internal-flow Reynolds number is in a nominal laminar range.';
      const metric: PhysicsAdvisorMetric = {
        id: `reynolds:${inlet.id}:${body.id}`,
        kind: 'reynolds_number',
        symbol: 'Re',
        value: reynolds,
        status,
        interpretation,
        inputs: [
          { name: 'mean inlet speed', value: velocity, unit: 'm/s', sourceRef: inlet.id },
          { name: 'hydraulic diameter', value: hydraulicDiameter, unit: 'm', sourceRef: body.id },
          { name: 'kinematic viscosity', value: transport.kinematicViscosity, unit: 'm2/s', sourceRef: material?.id },
        ],
        targetRefs: [body.id, inlet.id, ...(material ? [material.id] : [])],
      };
      metrics.push(metric);
      if (status !== 'nominal') {
        notices.push({
          severity: 'warning',
          code: status === 'warning' ? 'REYNOLDS_TURBULENT_RANGE' : 'REYNOLDS_TRANSITION_RANGE',
          message: `Re=${formatMetric(reynolds)} for ${body.name}. ${interpretation}`,
          targetRefs: metric.targetRefs,
          metricId: metric.id,
        });
        if (status === 'warning') {
          notices.push({
            severity: 'info',
            code: 'YPLUS_REQUIRES_SOLVER_RESULT',
            message: `Re=${formatMetric(reynolds)} indicates a turbulence-capable workflow. y+ requires wall distance and friction velocity from a generated mesh/solution and is not estimated here.`,
            targetRefs: metric.targetRefs,
            metricId: metric.id,
          });
        }
      }
    }
  }

  const fluidApplicable = ir.meta.domain_type === 'fluid'
    || ir.meta.domain_type === 'coupled'
    || channelBodies.length > 0;
  if (fluidApplicable && !metrics.some((metric) => metric.kind === 'reynolds_number')) {
    notices.push({
      severity: 'info',
      code: 'REYNOLDS_INPUTS_INCOMPLETE',
      message: 'Reynolds number requires a channel body, a velocity inlet assigned to it, and positive density/viscosity data.',
      targetRefs: [...channelBodies.map((body) => body.id), ...velocityInlets.map((condition) => condition.id)],
    });
  }
}

function addThermalMetrics(
  ir: ProjectIR,
  metrics: PhysicsAdvisorMetric[],
  notices: PhysicsAdvisorNotice[],
): void {
  const convectionConditions = ir.boundary_conditions.filter((condition) => condition.bc_type === 'convection');
  const transientThermalCases = ir.analysis_cases.filter(
    (analysisCase) => analysisCase.active
      && analysisCase.domain_type === 'thermal'
      && analysisCase.analysis_type === 'transient_thermal'
      && analysisCase.transient,
  );
  const duration = transientThermalCases[0]
    ? findThermalDuration(ir, transientThermalCases[0])
    : null;

  for (const condition of convectionConditions) {
    const selection = ir.named_selections.find((candidate) => candidate.id === condition.target_named_selection_id);
    const coefficient = positiveNumber(condition.values.heat_transfer_coefficient);
    if (!selection || !coefficient) continue;
    const bodyIds = selectionBodyIds(ir, selection);
    for (const bodyId of bodyIds) {
      const body = ir.geometry.bodies.find((candidate) => candidate.id === bodyId);
      const material = materialForBody(ir, bodyId);
      if (!body || !material) continue;
      const volume = primitiveVolume(body);
      const exposedArea = selectionArea(ir, selection, body);
      const conductivity = materialParameter(material, 'thermal_conductivity');
      if (!volume || !exposedArea || !conductivity) continue;
      const characteristicLength = volume / exposedArea;
      const biot = coefficient * characteristicLength / conductivity;
      const biotStatus: PhysicsAdvisorStatus = biot < 0.1
        ? 'nominal'
        : biot <= 1 ? 'caution' : 'warning';
      const biotInterpretation = biotStatus === 'nominal'
        ? 'Bi < 0.1; a lumped-temperature approximation may be reasonable if other assumptions hold.'
        : biotStatus === 'caution'
          ? 'Internal temperature gradients may be important; resolve conduction through the body.'
          : 'Strong internal temperature gradients are likely; use spatially resolved thermal analysis.';
      const biotMetric: PhysicsAdvisorMetric = {
        id: `biot:${condition.id}:${body.id}`,
        kind: 'biot_number',
        symbol: 'Bi',
        value: biot,
        status: biotStatus,
        interpretation: biotInterpretation,
        inputs: [
          { name: 'heat-transfer coefficient', value: coefficient, unit: 'W/(m2 K)', sourceRef: condition.id },
          { name: 'characteristic length V/A', value: characteristicLength, unit: 'm', sourceRef: body.id },
          { name: 'thermal conductivity', value: conductivity, unit: 'W/(m K)', sourceRef: material.id },
        ],
        targetRefs: [body.id, condition.id, material.id],
      };
      metrics.push(biotMetric);
      if (biotStatus !== 'nominal') {
        notices.push({
          severity: 'warning',
          code: biotStatus === 'warning' ? 'BIOT_HIGH' : 'BIOT_MODERATE',
          message: `Bi=${formatMetric(biot)} for ${body.name}. ${biotInterpretation}`,
          targetRefs: biotMetric.targetRefs,
          metricId: biotMetric.id,
        });
      }

      if (duration) {
        const density = materialParameter(material, 'density');
        const specificHeat = materialParameter(material, 'specific_heat');
        if (density && specificHeat) {
          const diffusivity = conductivity / (density * specificHeat);
          const fourier = diffusivity * duration.seconds / characteristicLength ** 2;
          const fourierStatus: PhysicsAdvisorStatus = fourier < 0.2 ? 'caution' : 'nominal';
          const fourierInterpretation = fourierStatus === 'caution'
            ? 'Thermal diffusion time is short relative to the body scale; strong transient gradients may remain.'
            : 'Thermal diffusion has progressed across a meaningful fraction of the characteristic body scale.';
          const fourierMetric: PhysicsAdvisorMetric = {
            id: `fourier:${condition.id}:${body.id}`,
            kind: 'fourier_number',
            symbol: 'Fo',
            value: fourier,
            status: fourierStatus,
            interpretation: fourierInterpretation,
            inputs: [
              { name: 'thermal diffusivity', value: diffusivity, unit: 'm2/s', sourceRef: material.id },
              { name: 'duration', value: duration.seconds, unit: 's', sourceRef: duration.sourceRef },
              { name: 'characteristic length V/A', value: characteristicLength, unit: 'm', sourceRef: body.id },
            ],
            targetRefs: [body.id, condition.id, material.id, duration.sourceRef],
          };
          metrics.push(fourierMetric);
          if (fourierStatus === 'caution') {
            notices.push({
              severity: 'warning',
              code: 'FOURIER_EARLY_TRANSIENT',
              message: `Fo=${formatMetric(fourier)} for ${body.name}. ${fourierInterpretation}`,
              targetRefs: fourierMetric.targetRefs,
              metricId: fourierMetric.id,
            });
          }
        }
      }
    }
  }

  const thermalApplicable = ir.meta.domain_type === 'thermal'
    || ir.meta.domain_type === 'coupled'
    || convectionConditions.length > 0;
  if (thermalApplicable && convectionConditions.length > 0
    && !metrics.some((metric) => metric.kind === 'biot_number')) {
    notices.push({
      severity: 'info',
      code: 'BIOT_INPUTS_INCOMPLETE',
      message: 'Biot number requires a convection coefficient, selected face area, body volume, material assignment, and conductivity.',
      targetRefs: convectionConditions.map((condition) => condition.id),
    });
  }
  if (transientThermalCases.length > 0 && !metrics.some((metric) => metric.kind === 'fourier_number')) {
    notices.push({
      severity: 'info',
      code: 'FOURIER_INPUTS_INCOMPLETE',
      message: 'Fourier number requires Biot geometry inputs, density, specific heat, and a positive duration in solver options.',
      targetRefs: transientThermalCases.map((analysisCase) => analysisCase.id),
    });
  }
}

function sectionSlendernessProperties(section: Section): { area: number; minimumInertia: number } | null {
  const area = positiveNumber(section.area) ?? derivedSectionArea(section);
  const inertiaValues = [section.inertia_y, section.inertia_z]
    .map(positiveNumber)
    .filter((value): value is number => value !== null);
  const derived = derivedSectionInertias(section);
  if (inertiaValues.length === 0 && derived) inertiaValues.push(...derived);
  return area && inertiaValues.length > 0
    ? { area, minimumInertia: Math.min(...inertiaValues) }
    : null;
}

function derivedSectionArea(section: Section): number | null {
  const diameter = positiveNumber(section.dimensions.diameter);
  if (section.section_type === 'beam_circle' && diameter) return Math.PI * diameter ** 2 / 4;
  const width = positiveNumber(section.dimensions.width);
  const height = positiveNumber(section.dimensions.height);
  return section.section_type === 'beam_rect' && width && height ? width * height : null;
}

function derivedSectionInertias(section: Section): number[] | null {
  const diameter = positiveNumber(section.dimensions.diameter);
  if (section.section_type === 'beam_circle' && diameter) return [Math.PI * diameter ** 4 / 64];
  const width = positiveNumber(section.dimensions.width);
  const height = positiveNumber(section.dimensions.height);
  return section.section_type === 'beam_rect' && width && height
    ? [width * height ** 3 / 12, height * width ** 3 / 12]
    : null;
}

function edgesForSelection(ir: ProjectIR, selection: NamedSelection): GeometryEdge[] {
  const memberRefs = new Set(selection.member_refs);
  const explicitlySelectedBodyIds = new Set(
    ir.geometry.bodies
      .filter((body) => memberRefs.has(body.id))
      .map((body) => body.id),
  );
  return ir.geometry.edges.filter(
    (edge) => memberRefs.has(edge.id) || explicitlySelectedBodyIds.has(edge.body_id),
  );
}

function transformedEdgeLength(ir: ProjectIR, edge: GeometryEdge): number | null {
  const body = ir.geometry.bodies.find((candidate) => candidate.id === edge.body_id);
  const start = ir.geometry.vertices.find((vertex) => vertex.id === edge.vertex_ids[0]);
  const end = ir.geometry.vertices.find((vertex) => vertex.id === edge.vertex_ids[1]);
  if (body && start && end) {
    return Math.hypot(
      (end.position[0] - start.position[0]) * body.transform.scale[0],
      (end.position[1] - start.position[1]) * body.transform.scale[1],
      (end.position[2] - start.position[2]) * body.transform.scale[2],
    );
  }
  const length = positiveNumber(edge.length);
  return length && body ? length * Math.max(...body.transform.scale.map(Math.abs)) : length;
}

function inletVelocity(condition: BoundaryCondition): number | null {
  if (condition.values.vector) {
    const speed = Math.hypot(...condition.values.vector);
    return positiveNumber(speed);
  }
  return positiveNumber(Math.abs(condition.values.scalar ?? 0));
}

function fluidTransport(material: Material): { kinematicViscosity: number } | null {
  const kinematic = materialParameter(material, 'kinematic_viscosity');
  if (kinematic) return { kinematicViscosity: kinematic };
  const dynamic = materialParameter(material, 'dynamic_viscosity');
  const density = materialParameter(material, 'density');
  return dynamic && density ? { kinematicViscosity: dynamic / density } : null;
}

function materialParameter(
  material: Material,
  key: keyof Material['parameter_set'],
): number | null {
  return positiveNumber(material.parameter_set[key]?.value);
}

function materialForBody(ir: ProjectIR, bodyId: string): Material | null {
  for (const assignment of ir.material_assignments) {
    const selection = ir.named_selections.find((candidate) => candidate.id === assignment.target_named_selection_id);
    if (selection && selectionBodyIds(ir, selection).has(bodyId)) {
      return ir.materials.find((material) => material.id === assignment.material_id) ?? null;
    }
  }
  return null;
}

function selectionBodyIds(ir: ProjectIR, selection: NamedSelection): Set<string> {
  const result = new Set<string>();
  const bodyIds = new Set(ir.geometry.bodies.map((body) => body.id));
  const faces = new Map(ir.geometry.faces.map((face) => [face.id, face.body_id]));
  const edges = new Map(ir.geometry.edges.map((edge) => [edge.id, edge.body_id]));
  const vertices = new Map(ir.geometry.vertices.map((vertex) => [vertex.id, vertex.body_id]));
  for (const memberRef of selection.member_refs) {
    if (bodyIds.has(memberRef)) result.add(memberRef);
    const bodyId = faces.get(memberRef) ?? edges.get(memberRef) ?? vertices.get(memberRef);
    if (bodyId) result.add(bodyId);
  }
  return result;
}

function selectionArea(ir: ProjectIR, selection: NamedSelection, body: GeometryBody): number | null {
  const memberRefs = new Set(selection.member_refs);
  const areas = ir.geometry.faces
    .filter((face) => face.body_id === body.id && memberRefs.has(face.id))
    .map((face) => {
      const area = positiveNumber(face.area);
      return area ? area * faceAreaScale(body, face.normal) : null;
    })
    .filter((area): area is number => area !== null);
  return areas.length > 0 ? areas.reduce((sum, area) => sum + area, 0) : null;
}

function faceAreaScale(body: GeometryBody, normal?: [number, number, number]): number {
  const [sx, sy, sz] = body.transform.scale.map(Math.abs);
  if (!normal) return [sx * sy, sy * sz, sx * sz].sort((a, b) => b - a)[0];
  const norm = Math.hypot(...normal);
  if (norm === 0 || sx === 0 || sy === 0 || sz === 0) return 0;
  const [nx, ny, nz] = normal.map((component) => component / norm);
  return sx * sy * sz * Math.hypot(nx / sx, ny / sy, nz / sz);
}

function primitiveVolume(body: GeometryBody): number | null {
  const value = (key: string) => positiveNumber(body.metadata[key]);
  let volume: number | null = null;
  switch (body.metadata.shapeType) {
    case 'box':
      volume = multiplyPositive(value('width'), value('height'), value('depth'));
      break;
    case 'channel':
      volume = multiplyPositive(value('length'), value('height'), value('depth'));
      break;
    case 'plate':
      volume = multiplyPositive(value('width'), value('depth'), value('thickness'));
      break;
    case 'plateWithHole': {
      const width = value('width');
      const depth = value('depth');
      const thickness = value('thickness');
      const radius = value('holeRadius');
      if (width && depth && thickness && radius && 2 * radius < Math.min(width, depth)) {
        volume = (width * depth - Math.PI * radius ** 2) * thickness;
      }
      break;
    }
    case 'cylinder': {
      const radius = value('radius');
      const height = value('height');
      if (radius && height) volume = Math.PI * radius ** 2 * height;
      break;
    }
    case 'pipe': {
      const outer = value('outerRadius');
      const inner = value('innerRadius');
      const length = value('length');
      if (outer && inner && length && inner < outer) volume = Math.PI * (outer ** 2 - inner ** 2) * length;
      break;
    }
    case 'lBracket': {
      const width = value('width');
      const height = value('height');
      const thickness = value('thickness');
      const depth = value('depth');
      if (width && height && thickness && depth && thickness < Math.min(width, height)) {
        volume = (width * thickness + height * thickness - thickness ** 2) * depth;
      }
      break;
    }
  }
  return volume === null
    ? null
    : volume * Math.abs(body.transform.scale[0] * body.transform.scale[1] * body.transform.scale[2]);
}

function scaledMetadataLength(body: GeometryBody, key: string, axis: 0 | 1 | 2): number | null {
  const length = positiveNumber(body.metadata[key]);
  return length ? length * Math.abs(body.transform.scale[axis]) : null;
}

function findThermalDuration(
  ir: ProjectIR,
  analysisCase: ProjectIR['analysis_cases'][number],
): ThermalDuration | null {
  const keys = [
    'duration', 'end_time', 'endTime', 'total_time', 'totalTime',
    'simulation_time', 'simulationTime', 'time_horizon', 'timeHorizon',
  ];
  const targetName = analysisCase.solver_profile_hint.startsWith('openseespy_')
    ? 'OpenSeesPy'
    : analysisCase.solver_profile_hint.startsWith('dolfinx_') ? 'DOLFINx' : 'OpenFOAM';
  const target = ir.solver_targets.find((candidate) => candidate.target_name === targetName);
  if (!target) return null;
  for (const key of keys) {
    const seconds = positiveNumber(target.solver_options[key]);
    if (seconds) return { seconds, sourceRef: `${target.target_name}.solver_options.${key}` };
  }
  return null;
}

function multiplyPositive(...values: Array<number | null>): number | null {
  return values.every((value): value is number => value !== null)
    ? values.reduce((product, value) => product * value, 1)
    : null;
}

function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function formatMetric(value: number): string {
  return value >= 1_000 || value < 0.01 ? value.toExponential(3) : value.toPrecision(4);
}
