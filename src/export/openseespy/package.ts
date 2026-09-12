import type { ProjectIR } from '@/core/ir/types';
import { scopeProjectForAnalysisCaseValidation } from '@/export/compiler';
import { downloadArtifactZip, type ArtifactFiles } from '@/export/shared/packaging';
import { pythonRuntimeFiles } from '@/export/shared/python-runtime';
import { exportOpenSeesPy } from './exporter';
import type { OpenSeesPyExportResult } from './model';

export function openSeesPyPackageFiles(result: OpenSeesPyExportResult): ArtifactFiles {
  return {
    ...pythonRuntimeFiles('openseespy'),
    'model.py': result.script,
    'nodes.csv': result.nodesCsv,
    'elements.csv': result.elementsCsv,
    'export_manifest.json': result.manifest,
    'run.sh': '#!/usr/bin/env bash\nset -euo pipefail\ncd "$(dirname "$0")"\nuv sync --locked --no-dev\nuv run --locked --no-dev python -m py_compile model.py\nuv run --locked --no-dev python model.py | tee solver.log\n',
    'README.txt': 'Verified with uv 0.9.7, Python 3.12.12 and OpenSeesPy 3.7.1.2 on Linux. Run: bash run.sh\nThe locked Python environment is created by uv. Linux is the supported validation runtime; platform-specific OpenSees native wheels must be available.\nAnalysis return code, forces and moments are checked. Import result_package.json for the exported node mapping and deformation fields.\n',
  };
}

export async function downloadOpenSeesPyZip(ir: ProjectIR, analysisCaseId?: string): Promise<OpenSeesPyExportResult> {
  const exportIr = analysisCaseId ? scopeProjectForAnalysisCaseValidation(ir, analysisCaseId) : ir;
  const result = exportOpenSeesPy(exportIr);
  if (result.success) await downloadArtifactZip(openSeesPyPackageFiles(result), ir.meta.project_name, 'openseespy');
  return result;
}
