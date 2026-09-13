import type { NativeShapeParams } from '@/core/ir/schema/shapes';

export type CADFormat = 'step' | 'iges';
export interface CADFaceRange { first: number; count: number }
export interface CADImportData { preview: ArrayBuffer; faces: CADFaceRange[]; roots: number }
export interface CADExportBody {
  name: string;
  matrix: number[];
  shape: NativeShapeParams | { shapeType: 'imported_cad'; format: CADFormat; data: Uint8Array };
  lines?: Array<[[number, number, number], [number, number, number]]>;
}
export type CADRequest = { operation: 'import'; format: CADFormat; data: Uint8Array }
  | { operation: 'export'; format: CADFormat; bodies: CADExportBody[] };
export type CADResponse = { success: true; result: CADImportData | Uint8Array } | { success: false; error: string };
