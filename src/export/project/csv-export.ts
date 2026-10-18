import type { ProjectIR } from '@/core/ir/types';
import { sanitizeArtifactName, serializeCsv, type ArtifactScalar } from '@/export/shared/artifact-sanitization';
import { buildConditionReportTables, buildReproductionReportTables, REPORT_UNIT_BASIS } from './report-data';

export function exportConditionsCsv(ir: ProjectIR): string {
  const records: ArtifactScalar[][] = [
    ['# FEM Modeler - Conditions Summary'],
    [`# Project: ${ir.meta.project_name}`],
    [`# Report units: ${REPORT_UNIT_BASIS}`],
    [`# Display preference only: ${ir.units.system_name}`],
    ['# Dynamic viscosity μ [Pa·s]; kinematic viscosity ν [m²/s]; ν = μ / ρ'],
    [`# Exported: ${new Date().toISOString()}`],
    [],
  ];
  for (const table of [...buildConditionReportTables(ir), ...buildReproductionReportTables(ir)]) {
    records.push([`## ${table.title}`], table.columns, ...table.rows, []);
  }
  return serializeCsv(records);
}

export function downloadConditionsCsv(ir: ProjectIR): { fileName: string; bytes: number } {
  const blob = new Blob([exportConditionsCsv(ir)], { type: 'text/csv;charset=utf-8' });
  const fileName = `${sanitizeArtifactName(ir.meta.project_name, 'project')}_conditions.csv`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
  return { fileName, bytes: blob.size };
}
