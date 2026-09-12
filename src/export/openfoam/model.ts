import type {
  BoundaryCondition,
  GeometryFace,
  Material,
  NamedSelection
} from '@/core/ir/types';


export interface OpenFOAMExportResult {
  success: boolean;
  files: Record<string, string>;
  manifest: string;
  errors: string[];
  warnings: string[];
}

export type SimulationMode = '2D' | '3D';

export type FrontBackType = 'empty' | 'wall' | 'patch';

export type PressureBasis = 'dynamic' | 'kinematic';

export interface PatchInfo {
  name: string;
  type: 'patch' | 'wall' | 'empty';
  bc?: BoundaryCondition;
  selection?: NamedSelection;
  face?: GeometryFace;
}

export interface ResolvedPatches {
  inlet: PatchInfo;
  outlet: PatchInfo;
  wallTop: PatchInfo;
  wallBottom: PatchInfo;
  frontAndBack: PatchInfo;
  unique: boolean;
}

export interface MaterialProperties {
  material?: Material;
  assignmentId?: string;
  assignmentSelectionId?: string;
  density?: number;
  kinematicViscosity?: number;
}

export type ChannelBoundaryRole = 'inlet' | 'outlet' | 'wall_top' | 'wall_bottom';

export interface ResolvedBoundarySelection {
  role: ChannelBoundaryRole;
  selection: NamedSelection;
  face: GeometryFace;
}

export interface ResolvedPressure {
  inputValue: number;
  basis: PressureBasis;
  kinematicValue: number;
}

/** Validated numerical inputs consumed by the OpenFOAM dictionary renderer. */
export interface OpenFOAMSolverModel {
  patches: ResolvedPatches;
  inletVelocity: [number, number, number];
  outletKinematicPressure: number;
  kinematicViscosity: number;
}
