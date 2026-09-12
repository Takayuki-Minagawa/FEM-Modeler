import type {
  AnalysisCase,
  Material,
  NamedSelection,
  ProjectIR,
  Section
} from '@/core/ir/types';


export interface OpenSeesPyNode {
  id: number;
  x: number;
  y: number;
  z: number;
  bodyId: string;
  sourceRefs: string[];
}

export interface OpenSeesPyTopologyElement {
  id: number;
  nodeI: number;
  nodeJ: number;
  bodyId: string;
  sourceRefs: string[];
}

export interface OpenSeesPyElement extends OpenSeesPyTopologyElement {
  sectionId: string;
  sectionTag: number;
  materialId: string;
  materialTag: number;
  area: number;
  youngModulus: number;
  inertiaZ: number | null;
  transfTag: number;
}

export interface OpenSeesPyFixCondition {
  nodeId: number;
  dofs: number[];
}

export interface OpenSeesPyPrescribedDisplacement {
  nodeId: number;
  dof: number;
  value: number;
}

export interface OpenSeesPyNodalLoad {
  nodeId: number;
  fx: number;
  fy: number;
}

export interface OpenSeesPyTopology {
  bodyId: string;
  shapeType: 'frame2d' | 'truss2d';
  ndm: 2;
  ndf: 2 | 3;
  elementType: 'Truss' | 'elasticBeamColumn';
  nodes: OpenSeesPyNode[];
  elements: OpenSeesPyTopologyElement[];
}

export interface OpenSeesPyModel extends Omit<OpenSeesPyTopology, 'elements'> {
  elements: OpenSeesPyElement[];
  materials: Array<{ tag: number; material: Material; youngModulus: number }>;
  sections: Array<{ tag: number; section: Section }>;
  fixes: OpenSeesPyFixCondition[];
  prescribedDisplacements: OpenSeesPyPrescribedDisplacement[];
  nodalLoads: OpenSeesPyNodalLoad[];
}

export interface OpenSeesPyTopologyResult {
  topology: OpenSeesPyTopology | null;
  errors: string[];
}

export interface OpenSeesPyCompileResult {
  model: OpenSeesPyModel | null;
  topology: OpenSeesPyTopology | null;
  errors: string[];
  warnings: string[];
  analysisCaseId: string | null;
  consumedIds: string[];
  ignoredIds: string[];
}

export interface OpenSeesPyExportResult {
  success: boolean;
  script: string;
  nodesCsv: string;
  elementsCsv: string;
  manifest: string;
  errors: string[];
  warnings: string[];
}

export interface LocalNode {
  position: [number, number, number];
  sourceRefs: string[];
}

export interface LocalElement {
  nodeI: number;
  nodeJ: number;
  sourceRefs: string[];
}

export interface ResolvedBinding<T> {
  value: T;
  selection: NamedSelection;
}

export interface OpenSeesCaseScope {
  ir: ProjectIR;
  analysisCase: AnalysisCase | null;
  errors: string[];
  warnings: string[];
  consumedIds: string[];
  ignoredIds: string[];
}

export type DofConstraint =
  | { kind: 'fixed' }
  | { kind: 'prescribed'; value: number };
