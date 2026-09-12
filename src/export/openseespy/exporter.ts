import { createExportProvenance } from '@/core/ir/provenance';
import type {
  ProjectIR
} from '@/core/ir/types';
import { compileOpenSeesPyModel } from './compile';
import type { OpenSeesPyExportResult } from './model';
import { renderOpenSeesPyScript } from './render';

export function exportOpenSeesPy(ir: ProjectIR): OpenSeesPyExportResult {
  const compiled = compileOpenSeesPyModel(ir);
  const { model, topology, errors, warnings } = compiled;
  const provenance = model && errors.length === 0 ? createExportProvenance(ir, 'OpenSeesPy', compiled.analysisCaseId ?? undefined) : undefined;
  const script = model && provenance ? renderOpenSeesPyScript(ir, model, provenance) : '';
  const nodesCsv = topology
    ? ['id,x,y,z', ...topology.nodes.map((node) => `${node.id},${node.x},${node.y},${node.z}`)].join('\n')
    : '';
  const elementsForCsv = model?.elements ?? topology?.elements ?? [];
  const elementsCsv = elementsForCsv.length > 0
    ? [
      'id,nodeI,nodeJ,sectionTag',
      ...elementsForCsv.map((element) => {
        const sectionTag = 'sectionTag' in element ? element.sectionTag : '';
        return `${element.id},${element.nodeI},${element.nodeJ},${sectionTag}`;
      }),
    ].join('\n')
    : '';

  const manifest = JSON.stringify({
    export_target: 'OpenSeesPy',
    ...provenance,
    export_time: new Date().toISOString(),
    source_project: ir.meta.project_name,
    schema_version: ir.meta.schema_version,
    model_revision: ir.validation.model_revision,
    ndm: topology?.ndm ?? null,
    ndf: topology?.ndf ?? null,
    elementType: topology?.elementType ?? null,
    node_count: topology?.nodes.length ?? 0,
    element_count: topology?.elements.length ?? 0,
    analysis_case_id: compiled.analysisCaseId,
    section_ids: model?.sections.map(({ section }) => section.id) ?? [],
    material_ids: model?.materials.map(({ material }) => material.id) ?? [],
    consumed_ir_ids: compiled.consumedIds,
    ignored_ir_ids: compiled.ignoredIds,
    generated_files: [
      'model.py',
      'nodes.csv',
      'elements.csv',
      'export_manifest.json',
      'pyproject.toml',
      'uv.lock',
      '.python-version',
      'result_package.json (runtime)',
      'run.sh',
      'README.txt', 'runtime/lifecycle.sh', 'runtime/failure_manifest.json',
    ],
    warnings,
    errors,
  }, null, 2);

  return {
    success: errors.length === 0 && model !== null,
    script,
    nodesCsv,
    elementsCsv,
    manifest,
    errors,
    warnings,
  };
}

export { compileOpenSeesPyModel } from './compile';
export type * from './model';
export { downloadOpenSeesPyZip } from './package';
export { buildOpenSeesPyTopology } from './topology';
