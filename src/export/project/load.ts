import type { ProjectIR } from '@/core/ir/types';
import { SCHEMA_NAME } from '@/core/ir/defaults';

export interface LoadResult {
  success: boolean;
  data?: ProjectIR;
  error?: string;
}

export function parseProjectFile(json: string): LoadResult {
  try {
    const data = JSON.parse(json) as ProjectIR;

    if (!data.meta) {
      return { success: false, error: 'Invalid project file: missing meta section' };
    }

    if (data.meta.schema_name !== SCHEMA_NAME) {
      return {
        success: false,
        error: `Unknown schema: ${data.meta.schema_name}. Expected: ${SCHEMA_NAME}`,
      };
    }

    return { success: true, data };
  } catch (e) {
    return {
      success: false,
      error: `JSON parse error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}
