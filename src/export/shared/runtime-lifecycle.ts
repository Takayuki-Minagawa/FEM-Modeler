import lifecycle from './runtime/lifecycle.sh?raw';
import type { ArtifactFiles } from './packaging';

/** Shared shell guard also works when uv/Python/native solver setup itself fails. */
export function solverLifecycleFiles(exportManifest: string): ArtifactFiles {
  const manifest = JSON.parse(exportManifest) as Record<string, unknown>;
  const keys = ['project_id', 'analysis_case_id', 'export_target', 'input_fingerprint', 'comparison_fingerprint', 'run_id', 'model_revision'];
  const provenance = Object.fromEntries(keys.filter((key) => manifest[key] !== undefined).map((key) => [key, manifest[key]]));
  return {
    'runtime/lifecycle.sh': lifecycle,
    'runtime/failure_manifest.json': JSON.stringify({ ...provenance, execution_return_code: -1,
      execution_status: 'not_completed', numerical_convergence: 'not_evaluated',
      error: 'This invocation has not completed successfully. Inspect the solver and runtime logs.' }, null, 2),
  };
}

export function solverRunScript(commands: string): string {
  return '#!/usr/bin/env bash\nset -euo pipefail\ncd "$(dirname "$0")"\nsource runtime/lifecycle.sh\n' + commands;
}
