import type { ProjectIR } from '@/core/ir/types';
import { sanitizeArtifactName } from '@/export/shared/artifact-sanitization';
import type { DownloadedArtifact } from '@/export/shared/packaging';

export function serializeProject(ir: ProjectIR): string {
  const data = {
    ...ir,
    meta: {
      ...ir.meta,
      updated_at: new Date().toISOString(),
    },
  };
  return JSON.stringify(data, null, 2);
}

export function downloadProjectFile(ir: ProjectIR): DownloadedArtifact {
  const json = serializeProject(ir);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${sanitizeArtifactName(ir.meta.project_name)}.fem.json`;
  a.click();
  URL.revokeObjectURL(url);
  return { fileName: a.download, bytes: blob.size };
}
