import type { ExportProvenance } from '@/core/ir/provenance';
import type {
  AnalysisCase,
  BoundaryCondition,
  GeometryBody,
  GeometryFace,
  Load,
  Material,
  NamedSelection,
  ProjectIR,
} from '@/core/ir/types';


export interface DOLFINxExportResult {
  success: boolean;
  script: string;
  geoFile: string;
  manifest: string;
  errors: string[];
  warnings: string[];
}

export type PhysicsMode = 'structural' | 'thermal';

export type SupportedShapeType = 'box' | 'plate' | 'plateWithHole' | 'cylinder';

export type ShapeDefinition =
  | { type: 'box'; width: number; height: number; depth: number }
  | { type: 'plate'; width: number; thickness: number; depth: number }
  | { type: 'plateWithHole'; width: number; thickness: number; depth: number; holeRadius: number }
  | { type: 'cylinder'; radius: number; height: number };

export interface ResolvedSurfaceSelection {
  selection: NamedSelection;
  faces: GeometryFace[];
  tag: number;
  canonical: boolean;
}

export interface ResolvedMaterialAssignment {
  material: Material;
  assignmentId: string;
  selectionId: string;
}

export interface ExportContext {
  provenance: ExportProvenance;
  ir: ProjectIR;
  body: GeometryBody;
  shape: ShapeDefinition;
  mode: PhysicsMode;
  material: Material;
  materialAssignmentId: string;
  materialSelectionId: string;
  analysisCase?: AnalysisCase;
  boundaryConditions: BoundaryCondition[];
  loads: Load[];
  surfaceSelections: Map<string, ResolvedSurfaceSelection>;
  tagBySelectionId: Map<string, number>;
  tagMap: Record<string, number>;
}
