import type { STLImportResult, STLSourceUnit } from './stl-loader';

export interface STLWorkerRequest { buffer: ArrayBuffer; fileName: string; scaleToMeters: number; sourceUnit: STLSourceUnit }
export type STLWorkerResponse = Omit<STLImportResult, 'geometry'> & { positions?: Float32Array; normals?: Float32Array };
