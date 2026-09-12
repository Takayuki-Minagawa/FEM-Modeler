import type { SolverTargetName } from '@/core/ir/types';
import { MAX_RESULT_TEXT_BYTES, parseResultText } from './importer';
import type { ResultImportResponse } from './importer';

export interface ResultParseRequest {
  file: Pick<File, 'name' | 'size' | 'text'>;
  analysisCaseId: string;
  solverTarget: SolverTargetName;
}

/** File reading and parsing both run in the Worker for large inputs. */
export async function parseResultFileRequest(request: ResultParseRequest): Promise<ResultImportResponse> {
  if (request.file.size > MAX_RESULT_TEXT_BYTES) {
    return { success: false, error: 'Result file exceeds the 20 MB safety limit.', warnings: [] };
  }
  try {
    const text = await request.file.text();
    return parseResultText(text, request.file.name, request.analysisCaseId, request.solverTarget);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error), warnings: [] };
  }
}
