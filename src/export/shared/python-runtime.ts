import openseesProject from '../../../solver-tests/openseespy/pyproject.toml?raw';
import openseesLock from '../../../solver-tests/openseespy/uv.lock?raw';
import dolfinxProject from '../../../solver-tests/dolfinx/pyproject.toml?raw';
import dolfinxLock from '../../../solver-tests/dolfinx/uv.lock?raw';
import openfoamProject from '../../../solver-tests/openfoam/pyproject.toml?raw';
import openfoamLock from '../../../solver-tests/openfoam/uv.lock?raw';
import type { ArtifactFiles } from './packaging';

export function pythonRuntimeFiles(solver: 'openseespy' | 'dolfinx' | 'openfoam'): ArtifactFiles {
  const [project, lock] = { openseespy: [openseesProject, openseesLock], dolfinx: [dolfinxProject, dolfinxLock], openfoam: [openfoamProject, openfoamLock] }[solver];
  return { 'pyproject.toml': project, 'uv.lock': lock, '.python-version': solver === 'dolfinx' ? '3.12.3\n' : '3.12.12\n' };
}
