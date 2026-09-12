import type { ProjectIR } from '@/core/ir/types';
import { scopeProjectForAnalysisCaseValidation } from '@/export/compiler';
import { downloadArtifactZip, type ArtifactFiles } from '@/export/shared/packaging';
import { pythonRuntimeFiles } from '@/export/shared/python-runtime';
import { exportDOLFINx } from './exporter';
import type { DOLFINxExportResult } from './model';

export function dolfinxPackageFiles(result: DOLFINxExportResult): ArtifactFiles {
  return {
    ...pythonRuntimeFiles('dolfinx'),
    'solve.py': result.script,
    'model.geo': result.geoFile,
    'export_manifest.json': result.manifest,
    'run.sh': `#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# Keep the image's native PETSc/MPI/DOLFINx bindings visible in the uv environment.
export PYTHONPATH="$(python3 -c 'import site; print(":".join(site.getsitepackages()))'):\${PYTHONPATH:-}"
uv venv --python "\${DOLFINX_PYTHON:-python3}" --system-site-packages --allow-existing .venv
uv sync --locked --no-dev --inexact
export PYTHONPATH="$PWD/.venv/lib/python3.12/site-packages:$PYTHONPATH"
uv run --locked --no-dev --no-sync gmsh -3 model.geo -format msh4 -o model.msh
uv run --locked --no-dev --no-sync python -m py_compile solve.py
mpirun -n "\${NPROC:-1}" .venv/bin/python solve.py | tee solver.log
`,
    'README.txt': 'Verified DOLFINx 0.10.0 / Python 3.12.3 / Gmsh 4.15 native image:\nghcr.io/fenics/dolfinx/dolfinx@sha256:f7cce2a2271bf838c080751348c471064acb41fef0330e2c08178a688f71890d\nInstall uv 0.9.7 in the native image, then run bash run.sh (NPROC=2 for MPI).\nuv manages the Python project and inherits the image native bindings through --system-site-packages and PYTHONPATH. Native solver libraries are pinned by the image digest.\nResult fields in result_package.json are projected to the linear mesh for visualization; result.xdmf retains the original solution.\n',
  };
}

export async function downloadDOLFINxZip(ir: ProjectIR, analysisCaseId?: string): Promise<DOLFINxExportResult> {
  const exportIr = analysisCaseId ? scopeProjectForAnalysisCaseValidation(ir, analysisCaseId) : ir;
  const result = exportDOLFINx(exportIr);
  if (result.success) await downloadArtifactZip(dolfinxPackageFiles(result), ir.meta.project_name, 'dolfinx');
  return result;
}
