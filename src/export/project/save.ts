import type { ProjectIR } from '@/core/ir/types';

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

export function downloadProjectFile(ir: ProjectIR): void {
  const json = serializeProject(ir);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${ir.meta.project_name.replace(/\s+/g, '_')}.fem.json`;
  a.click();
  URL.revokeObjectURL(url);
}
