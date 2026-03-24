import type { ProjectIR } from '@/core/ir/types';
import { normalizeAndValidateProjectData } from './project-file-schema';

export interface LoadResult {
  success: boolean;
  data?: ProjectIR;
  error?: string;
  warning?: string;
}

export function parseProjectFile(json: string): LoadResult {
  try {
    const raw = JSON.parse(json) as unknown;
    const result = normalizeAndValidateProjectData(raw);
    if (!result.success) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      data: result.data,
      warning: result.migratedFromVersion
        ? `Project file migrated from schema version ${result.migratedFromVersion} to the current version.`
        : undefined,
    };
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
