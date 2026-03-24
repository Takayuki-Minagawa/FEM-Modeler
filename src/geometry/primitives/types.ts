import type * as THREE from 'three';
import type { GeometryBody, GeometryFace, GeometryEdge, GeometryVertex } from '@/core/ir/types';

export interface ShapeParams {
  shapeType: string;
  [key: string]: unknown;
}

export interface BoxParams extends ShapeParams {
  shapeType: 'box';
  width: number;
  height: number;
  depth: number;
}

export interface CylinderParams extends ShapeParams {
  shapeType: 'cylinder';
  radius: number;
  height: number;
  segments: number;
}

export interface PlateParams extends ShapeParams {
  shapeType: 'plate';
  width: number;
  depth: number;
  thickness: number;
}

export interface PlateWithHoleParams extends ShapeParams {
  shapeType: 'plateWithHole';
  width: number;
  depth: number;
  thickness: number;
  holeRadius: number;
}

export interface PipeParams extends ShapeParams {
  shapeType: 'pipe';
  outerRadius: number;
  innerRadius: number;
  length: number;
  segments: number;
}

export interface LBracketParams extends ShapeParams {
  shapeType: 'lBracket';
  width: number;
  height: number;
  thickness: number;
  depth: number;
}

export interface FrameParams extends ShapeParams {
  shapeType: 'frame2d';
  spanX: number;
  spanY: number;
  columns: number;
  floors: number;
}

export interface TrussParams extends ShapeParams {
  shapeType: 'truss2d';
  span: number;
  height: number;
  divisions: number;
}

export interface ChannelParams extends ShapeParams {
  shapeType: 'channel';
  length: number;
  height: number;
  depth: number;
}

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
