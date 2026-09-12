import type { NativeShapeParams } from '@/core/ir/schema/shapes';
import type * as THREE from 'three';
import type { GeometryBody, GeometryFace, GeometryEdge, GeometryVertex } from '@/core/ir/types';

export interface ShapeParams {
  shapeType: string;
  [key: string]: unknown;
}

export type BoxParams = Extract<NativeShapeParams, { shapeType: 'box' }>;
export type CylinderParams = Extract<NativeShapeParams, { shapeType: 'cylinder' }>;
export type PlateParams = Extract<NativeShapeParams, { shapeType: 'plate' }>;
export type PlateWithHoleParams = Extract<NativeShapeParams, { shapeType: 'plateWithHole' }>;
export type PipeParams = Extract<NativeShapeParams, { shapeType: 'pipe' }>;
export type LBracketParams = Extract<NativeShapeParams, { shapeType: 'lBracket' }>;
export type FrameParams = Extract<NativeShapeParams, { shapeType: 'frame2d' }>;
export type TrussParams = Extract<NativeShapeParams, { shapeType: 'truss2d' }>;
export type ChannelParams = Extract<NativeShapeParams, { shapeType: 'channel' }>;

export interface ImportedStlParams extends ShapeParams {
  shapeType: 'imported_stl';
  fileName: string;
  triangleCount: number;
}

export type AnyShapeParams =
  | BoxParams
  | CylinderParams
  | PlateParams
  | PlateWithHoleParams
  | PipeParams
  | LBracketParams
  | FrameParams
  | TrussParams
  | ChannelParams
  | ImportedStlParams;

export interface GeneratedTopology {
  body: GeometryBody;
  faces: GeometryFace[];
  edges: GeometryEdge[];
  vertices: GeometryVertex[];
  threeGeometry: THREE.BufferGeometry;
}
