import type { ProjectIR } from '@/core/ir/types';
import { scopeProjectForAnalysisCaseValidation } from '@/export/compiler';
import { downloadArtifactZip, type ArtifactFiles } from '@/export/shared/packaging';
import { pythonRuntimeFiles } from '@/export/shared/python-runtime';
import { exportOpenFOAM } from './exporter';
import type { OpenFOAMExportResult } from './model';
import collector from './runtime/collect_results.py?raw';

export function openFoamPackageFiles(result: OpenFOAMExportResult): ArtifactFiles {
  return {
    ...result.files,
    ...pythonRuntimeFiles('openfoam'),
    'export_manifest.json': result.manifest,
    'collect_results.py': collector,
    'run.sh': '#!/usr/bin/env bash\nset -euo pipefail\ncd "$(dirname "$0")"\nuv sync --locked --no-dev\nblockMesh | tee blockMesh.log\ncheckMesh | tee checkMesh.log\nset +e\nsimpleFoam | tee solver.log\nsolver_status=${PIPESTATUS[0]}\nset -e\nuv run --locked --no-dev python collect_results.py "$solver_status"\nexit "$solver_status"\n',
    'README.txt': 'Verified with OpenFOAM Foundation 10 / uv 0.9.7 / Python 3.12.12. Native image:\nopenfoam/openfoam10-paraview510@sha256:d6ff1f9a2e7bc3c9177f373bebbdeb542fd8b49144afc24d5e3a3cd9bfae253d\nSource /opt/openfoam10/etc/bashrc, install uv, then run bash run.sh.\ncheckMesh gates the solve. surfaceFieldValue measures signed volumetric patch flux; density converts it to mass flow. The collector records measured residual history and imports never equate process success with numerical convergence.\nresult_package.json contains actual blockMesh hexahedra, cell pressure and speed.\n',
  };
}

export async function downloadOpenFOAMZip(ir: ProjectIR, analysisCaseId?: string): Promise<OpenFOAMExportResult> {
  const exportIr = analysisCaseId ? scopeProjectForAnalysisCaseValidation(ir, analysisCaseId) : ir;
  const result = exportOpenFOAM(exportIr);
  if (result.success) await downloadArtifactZip(openFoamPackageFiles(result), ir.meta.project_name, 'openfoam');
  return result;
}
