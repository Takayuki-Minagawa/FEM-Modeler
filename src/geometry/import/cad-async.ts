import { runCADTask } from '@/cad/async';
import { createCadSource, MAX_CAD_SOURCE_BYTES } from './cad-source';
import { importSTLAsync } from './stl-async';
import type { STLImportResult } from './stl-loader';
import { generateId } from '@/core/ir/id-generator';

export async function importCADAsync(buffer: ArrayBuffer, fileName: string, signal?: AbortSignal): Promise<STLImportResult> {
  const extension = fileName.split('.').pop()?.toLowerCase();
  const format = extension === 'step' || extension === 'stp' ? 'step' : extension === 'iges' || extension === 'igs' ? 'iges' : null;
  if (!format || buffer.byteLength === 0 || buffer.byteLength > MAX_CAD_SOURCE_BYTES) throw new Error('Select a non-empty STEP/IGES file up to 25 MiB.');
  const data = new Uint8Array(buffer);
  const converted = await runCADTask({ operation: 'import', format, data }, signal);
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  if (converted instanceof Uint8Array) throw new Error('Invalid CAD preview response.');
  const result = await importSTLAsync(converted.preview, fileName, 1, 'm', signal);
  if (!result.success || !result.body || !result.asset) return result;
  try {
    result.asset.cad_source = createCadSource(data, format, fileName);
    result.body.metadata = { ...result.body.metadata, shapeType: 'imported_cad', importFormat: format, cadRoots: converted.roots };
    result.faces = converted.faces.map((range, index) => ({ id: generateId('face'), name: `CAD face ${index + 1}`,
      body_id: result.body!.id, triangle_indices: Array.from({ length: range.count }, (_, triangle) => range.first + triangle) }));
    return result;
  } catch (error) { result.geometry?.dispose(); throw error; }
}
