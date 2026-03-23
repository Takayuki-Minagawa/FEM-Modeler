import * as THREE from 'three';
import { generateId } from '@/core/ir/id-generator';
import type { GeometryBody, GeometryFace, GeometryEdge, GeometryVertex, BodyCategory } from '@/core/ir/types';
import type {
  AnyShapeParams,
  GeneratedTopology,
  BoxParams,
  CylinderParams,
  PlateParams,
  PlateWithHoleParams,
  PipeParams,
  LBracketParams,
  FrameParams,
  TrussParams,
  ChannelParams,
} from './types';

const COLORS = [
  '#607d8b', '#78909c', '#546e7a', '#455a64',
  '#4a90d9', '#5c9ce6', '#3d7fc2', '#2e6da4',
  '#66bb6a', '#43a047', '#2e7d32',
  '#ef5350', '#e53935', '#c62828',
];

let colorIndex = 0;
function nextColor(): string {
  return COLORS[colorIndex++ % COLORS.length];
}

export function generateShape(params: AnyShapeParams, name?: string): GeneratedTopology {
  switch (params.shapeType) {
    case 'box': return generateBox(params as BoxParams, name);
    case 'cylinder': return generateCylinder(params as CylinderParams, name);
    case 'plate': return generatePlate(params as PlateParams, name);
    case 'plateWithHole': return generatePlateWithHole(params as PlateWithHoleParams, name);
    case 'pipe': return generatePipe(params as PipeParams, name);
    case 'lBracket': return generateLBracket(params as LBracketParams, name);
    case 'frame2d': return generateFrame2D(params as FrameParams, name);
    case 'truss2d': return generateTruss2D(params as TrussParams, name);
    case 'channel': return generateChannel(params as ChannelParams, name);
    default: return generateBox({ shapeType: 'box', width: 1, height: 1, depth: 1 }, name);
  }
}

function makeBody(name: string, category: BodyCategory, params: AnyShapeParams): GeometryBody {
  return {
    id: generateId('body'),
    name,
    category,
    visible: true,
    locked: false,
    color: nextColor(),
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    topology_ref: '',
    metadata: { ...params },
  };
}

function extractBoxFaces(bodyId: string, w: number, h: number, d: number): GeometryFace[] {
  const hw = w / 2, hh = h / 2, hd = d / 2;
  const faceNames = [
    { name: 'right',  normal: [1, 0, 0] as [number, number, number] },
    { name: 'left',   normal: [-1, 0, 0] as [number, number, number] },
    { name: 'top',    normal: [0, 1, 0] as [number, number, number] },
    { name: 'bottom', normal: [0, -1, 0] as [number, number, number] },
    { name: 'front',  normal: [0, 0, 1] as [number, number, number] },
    { name: 'back',   normal: [0, 0, -1] as [number, number, number] },
  ];

  return faceNames.map((f, i) => ({
    id: generateId('face'),
    name: f.name,
    body_id: bodyId,
    normal: f.normal,
    area: getBoxFaceArea(f.name, hw, hh, hd),
    triangle_indices: [i * 2, i * 2 + 1],
  }));
}

function getBoxFaceArea(name: string, hw: number, hh: number, hd: number): number {
  switch (name) {
    case 'right': case 'left': return (2 * hh) * (2 * hd);
    case 'top': case 'bottom': return (2 * hw) * (2 * hd);
    case 'front': case 'back': return (2 * hw) * (2 * hh);
    default: return 0;
  }
}

function extractBoxVertices(bodyId: string, w: number, h: number, d: number): GeometryVertex[] {
  const hw = w / 2, hh = h / 2, hd = d / 2;
  const positions: [number, number, number][] = [
    [-hw, -hh, -hd], [hw, -hh, -hd], [hw, hh, -hd], [-hw, hh, -hd],
    [-hw, -hh, hd], [hw, -hh, hd], [hw, hh, hd], [-hw, hh, hd],
  ];
  return positions.map((pos, i) => ({
    id: generateId('vertex'),
    name: `v${i}`,
    body_id: bodyId,
    position: pos,
  }));
}

function extractBoxEdges(bodyId: string, vertices: GeometryVertex[]): GeometryEdge[] {
  const edgePairs = [
    [0,1],[1,2],[2,3],[3,0], // back face
    [4,5],[5,6],[6,7],[7,4], // front face
    [0,4],[1,5],[2,6],[3,7], // connecting
  ];
  return edgePairs.map(([a, b], i) => ({
    id: generateId('edge'),
    name: `e${i}`,
    body_id: bodyId,
    vertex_ids: [vertices[a].id, vertices[b].id] as [string, string],
    length: Math.sqrt(
      (vertices[a].position[0] - vertices[b].position[0]) ** 2 +
      (vertices[a].position[1] - vertices[b].position[1]) ** 2 +
      (vertices[a].position[2] - vertices[b].position[2]) ** 2,
    ),
  }));
}

// ---------------------------------------------------------------------------
// Shape generators
// ---------------------------------------------------------------------------

function generateBox(p: BoxParams, name?: string): GeneratedTopology {
  const body = makeBody(name ?? 'Box', 'solid', p);
  const geo = new THREE.BoxGeometry(p.width, p.height, p.depth);
  const faces = extractBoxFaces(body.id, p.width, p.height, p.depth);
  const vertices = extractBoxVertices(body.id, p.width, p.height, p.depth);
  const edges = extractBoxEdges(body.id, vertices);
  return { body, faces, edges, vertices, threeGeometry: geo };
}

function generateCylinder(p: CylinderParams, name?: string): GeneratedTopology {
  const body = makeBody(name ?? 'Cylinder', 'solid', p);
  const geo = new THREE.CylinderGeometry(p.radius, p.radius, p.height, p.segments);
  const topFace: GeometryFace = { id: generateId('face'), name: 'top', body_id: body.id, normal: [0, 1, 0], area: Math.PI * p.radius ** 2, triangle_indices: [] };
  const bottomFace: GeometryFace = { id: generateId('face'), name: 'bottom', body_id: body.id, normal: [0, -1, 0], area: Math.PI * p.radius ** 2, triangle_indices: [] };
  const sideFace: GeometryFace = { id: generateId('face'), name: 'side', body_id: body.id, area: 2 * Math.PI * p.radius * p.height, triangle_indices: [] };
  return { body, faces: [topFace, bottomFace, sideFace], edges: [], vertices: [], threeGeometry: geo };
}

function generatePlate(p: PlateParams, name?: string): GeneratedTopology {
  const body = makeBody(name ?? 'Plate', 'solid', p);
  const geo = new THREE.BoxGeometry(p.width, p.thickness, p.depth);
  const faces = extractBoxFaces(body.id, p.width, p.thickness, p.depth);
  const vertices = extractBoxVertices(body.id, p.width, p.thickness, p.depth);
  const edges = extractBoxEdges(body.id, vertices);
  return { body, faces, edges, vertices, threeGeometry: geo };
}

function generatePlateWithHole(p: PlateWithHoleParams, name?: string): GeneratedTopology {
  const body = makeBody(name ?? 'Plate with Hole', 'solid', p);
  // Create plate with CSG-like approach using shape
  const plateShape = new THREE.Shape();
  const hw = p.width / 2, hd = p.depth / 2;
  plateShape.moveTo(-hw, -hd);
  plateShape.lineTo(hw, -hd);
  plateShape.lineTo(hw, hd);
  plateShape.lineTo(-hw, hd);
  plateShape.lineTo(-hw, -hd);

  const holePath = new THREE.Path();
  holePath.absarc(0, 0, p.holeRadius, 0, Math.PI * 2, false);
  plateShape.holes.push(holePath);

  const geo = new THREE.ExtrudeGeometry(plateShape, {
    depth: p.thickness,
    bevelEnabled: false,
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, p.thickness / 2, 0);

  const topFace: GeometryFace = { id: generateId('face'), name: 'top', body_id: body.id, normal: [0, 1, 0], triangle_indices: [] };
  const bottomFace: GeometryFace = { id: generateId('face'), name: 'bottom', body_id: body.id, normal: [0, -1, 0], triangle_indices: [] };
  const holeSurface: GeometryFace = { id: generateId('face'), name: 'hole_surface', body_id: body.id, triangle_indices: [] };
  const sides: GeometryFace[] = ['front', 'back', 'left', 'right'].map((n) => ({
    id: generateId('face'), name: n, body_id: body.id, triangle_indices: [],
  }));

  return { body, faces: [topFace, bottomFace, holeSurface, ...sides], edges: [], vertices: [], threeGeometry: geo };
}

function generatePipe(p: PipeParams, name?: string): GeneratedTopology {
  const body = makeBody(name ?? 'Pipe', 'solid', p);
  const outerGeo = new THREE.CylinderGeometry(p.outerRadius, p.outerRadius, p.length, p.segments, 1, true);
  const innerGeo = new THREE.CylinderGeometry(p.innerRadius, p.innerRadius, p.length, p.segments, 1, true);

  // Use LatheGeometry for proper pipe
  const pts = [
    new THREE.Vector2(p.innerRadius, -p.length / 2),
    new THREE.Vector2(p.outerRadius, -p.length / 2),
    new THREE.Vector2(p.outerRadius, p.length / 2),
    new THREE.Vector2(p.innerRadius, p.length / 2),
  ];
  const geo = new THREE.LatheGeometry(pts, p.segments);

  const outerFace: GeometryFace = { id: generateId('face'), name: 'outer_surface', body_id: body.id, triangle_indices: [] };
  const innerFace: GeometryFace = { id: generateId('face'), name: 'inner_surface', body_id: body.id, triangle_indices: [] };
  const topFace: GeometryFace = { id: generateId('face'), name: 'top_annulus', body_id: body.id, normal: [0, 1, 0], triangle_indices: [] };
  const bottomFace: GeometryFace = { id: generateId('face'), name: 'bottom_annulus', body_id: body.id, normal: [0, -1, 0], triangle_indices: [] };

  // Cleanup unused geometries
  outerGeo.dispose();
  innerGeo.dispose();

  return { body, faces: [outerFace, innerFace, topFace, bottomFace], edges: [], vertices: [], threeGeometry: geo };
}

function generateLBracket(p: LBracketParams, name?: string): GeneratedTopology {
  const body = makeBody(name ?? 'L-Bracket', 'solid', p);
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(p.width, 0);
  shape.lineTo(p.width, p.thickness);
  shape.lineTo(p.thickness, p.thickness);
  shape.lineTo(p.thickness, p.height);
  shape.lineTo(0, p.height);
  shape.lineTo(0, 0);

  const geo = new THREE.ExtrudeGeometry(shape, { depth: p.depth, bevelEnabled: false });
  geo.translate(-p.width / 2, -p.height / 2, -p.depth / 2);

  const faces: GeometryFace[] = ['front', 'back', 'bottom', 'right', 'inner_h', 'inner_v', 'top', 'left'].map((n) => ({
    id: generateId('face'), name: n, body_id: body.id, triangle_indices: [],
  }));

  return { body, faces, edges: [], vertices: [], threeGeometry: geo };
}

function generateFrame2D(p: FrameParams, name?: string): GeneratedTopology {
  const body = makeBody(name ?? '2D Frame', 'beam_region', p);
  const group = new THREE.BufferGeometry();
  const positions: number[] = [];
  const floorH = p.spanY / p.floors;
  const colSpacing = p.spanX / Math.max(p.columns - 1, 1);

  // Columns
  for (let c = 0; c < p.columns; c++) {
    const x = c * colSpacing;
    for (let f = 0; f < p.floors; f++) {
      positions.push(x, f * floorH, 0, x, (f + 1) * floorH, 0);
    }
  }
  // Beams
  for (let f = 1; f <= p.floors; f++) {
    const y = f * floorH;
    for (let c = 0; c < p.columns - 1; c++) {
      positions.push(c * colSpacing, y, 0, (c + 1) * colSpacing, y, 0);
    }
  }

  group.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

  const vertices: GeometryVertex[] = [];
  const edges: GeometryEdge[] = [];
  // Create node vertices
  for (let f = 0; f <= p.floors; f++) {
    for (let c = 0; c < p.columns; c++) {
      vertices.push({
        id: generateId('vertex'),
        name: `node_c${c}_f${f}`,
        body_id: body.id,
        position: [c * colSpacing, f * floorH, 0],
      });
    }
  }

  return { body, faces: [], edges, vertices, threeGeometry: group };
}

function generateTruss2D(p: TrussParams, name?: string): GeneratedTopology {
  const body = makeBody(name ?? '2D Truss', 'beam_region', p);
  const positions: number[] = [];
  const segLen = p.span / p.divisions;

  // Bottom chord
  for (let i = 0; i < p.divisions; i++) {
    positions.push(i * segLen, 0, 0, (i + 1) * segLen, 0, 0);
  }
  // Top chord (triangular)
  for (let i = 0; i < p.divisions; i++) {
    const x1 = i * segLen, x2 = (i + 1) * segLen;
    const y1 = Math.min(i, p.divisions - i) * (p.height / (p.divisions / 2));
    const y2 = Math.min(i + 1, p.divisions - i - 1) * (p.height / (p.divisions / 2));
    positions.push(x1, y1, 0, x2, y2, 0);
  }
  // Diagonals
  for (let i = 0; i <= p.divisions; i++) {
    const x = i * segLen;
    const y = Math.min(i, p.divisions - i) * (p.height / (p.divisions / 2));
    if (y > 0 || i === 0 || i === p.divisions) {
      positions.push(x, 0, 0, x, y, 0);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

  return { body, faces: [], edges: [], vertices: [], threeGeometry: geo };
}

function generateChannel(p: ChannelParams, name?: string): GeneratedTopology {
  const body = makeBody(name ?? 'Channel', 'fluid_region', p);
  const geo = new THREE.BoxGeometry(p.length, p.height, p.depth);
  const faces = extractBoxFaces(body.id, p.length, p.height, p.depth);
  // Rename for flow context
  faces.forEach((f) => {
    if (f.name === 'left') f.name = 'inlet';
    if (f.name === 'right') f.name = 'outlet';
    if (f.name === 'top') f.name = 'wall_top';
    if (f.name === 'bottom') f.name = 'wall_bottom';
    if (f.name === 'front') f.name = 'front_and_back';
    if (f.name === 'back') f.name = 'front_and_back_2';
  });
  const vertices = extractBoxVertices(body.id, p.length, p.height, p.depth);
  const edges = extractBoxEdges(body.id, vertices);
  return { body, faces, edges, vertices, threeGeometry: geo };
}

// ---------------------------------------------------------------------------
// Default parameters for each shape type
// ---------------------------------------------------------------------------

export const DEFAULT_SHAPE_PARAMS: Record<string, AnyShapeParams> = {
  box: { shapeType: 'box', width: 2, height: 2, depth: 2 },
  cylinder: { shapeType: 'cylinder', radius: 1, height: 3, segments: 32 },
  plate: { shapeType: 'plate', width: 4, depth: 3, thickness: 0.2 },
  plateWithHole: { shapeType: 'plateWithHole', width: 4, depth: 3, thickness: 0.2, holeRadius: 0.5 },
  pipe: { shapeType: 'pipe', outerRadius: 1, innerRadius: 0.8, length: 3, segments: 32 },
  lBracket: { shapeType: 'lBracket', width: 2, height: 3, thickness: 0.3, depth: 1 },
  frame2d: { shapeType: 'frame2d', spanX: 6, spanY: 9, columns: 3, floors: 3 },
  truss2d: { shapeType: 'truss2d', span: 10, height: 2, divisions: 6 },
  channel: { shapeType: 'channel', length: 6, height: 1, depth: 1 },
};
